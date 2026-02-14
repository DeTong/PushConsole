const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { execSync } = require('child_process');
const apn = require('apn');
const admin = require('firebase-admin');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 存储 APNs Provider 实例（按配置缓存）
let apnProvider = null;
let lastConfig = null;

// FCM：按 serviceAccount 缓存，避免重复初始化
let fcmApp = null;
let lastFcmConfigKey = null;

/**
 * 用系统 OpenSSL 将 P12 转为 PEM（cert + key），避免 Node 内置解析的兼容性问题
 */
function p12ToPem(p12Buffer, passphrase) {
  const tmpDir = os.tmpdir();
  const id = crypto.randomBytes(8).toString('hex');
  const p12Path = path.join(tmpDir, `apns-${id}.p12`);
  const pemPath = path.join(tmpDir, `apns-${id}.pem`);
  const passPath = path.join(tmpDir, `apns-${id}.pass`);

  try {
    fs.writeFileSync(p12Path, p12Buffer);
    fs.writeFileSync(passPath, passphrase || '', { mode: 0o600 });
    const passIn = `-passin file:${passPath}`;
    const cmd = (legacy) =>
      `openssl pkcs12 -in "${p12Path}" -out "${pemPath}" -nodes ${passIn}${legacy ? ' -legacy' : ''}`;
    try {
      execSync(cmd(false), { stdio: 'pipe' });
    } catch (e) {
      if (/unsupported|legacy|unknown option|Error reading/i.test(e.message || '')) {
        execSync(cmd(true), { stdio: 'pipe' });
      } else {
        throw e;
      }
    }
    const pemContent = fs.readFileSync(pemPath, 'utf8');
    const certMatch = pemContent.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    const keyMatch = pemContent.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/);
    if (!certMatch || !keyMatch) {
      throw new Error('P12 转换后无法解析出证书或私钥');
    }
    return { cert: certMatch[0], key: keyMatch[0] };
  } finally {
    try { fs.unlinkSync(p12Path); } catch (_) {}
    try { fs.unlinkSync(pemPath); } catch (_) {}
    try { fs.unlinkSync(passPath); } catch (_) {}
  }
}

function createProvider(config) {
  if (!config.p12Buffer || !config.bundleId) {
    throw new Error('缺少必要配置：p12Data, bundleId');
  }

  const { cert, key } = p12ToPem(config.p12Buffer, config.passphrase || '');

  const options = {
    cert,
    key,
    production: config.production || false,
  };

  return new apn.Provider(options);
}

/**
 * 初始化或复用 FCM App（使用 service account JSON）
 */
function getFcmApp(serviceAccountJson) {
  const configKey = crypto.createHash('md5').update(serviceAccountJson).digest('hex');
  if (fcmApp && lastFcmConfigKey === configKey) {
    return fcmApp;
  }
  if (fcmApp) {
    try {
      fcmApp.delete();
    } catch (_) {}
    fcmApp = null;
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  fcmApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'fcm-' + configKey.slice(0, 8));
  lastFcmConfigKey = configKey;
  return fcmApp;
}

/**
 * 华为 Push Kit：获取 OAuth2 访问令牌
 */
async function getHuaweiAccessToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'oauth-login.cloud.huawei.com',
        path: '/oauth2/v3/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) resolve(json.access_token);
            else reject(new Error(json.error_description || json.error || '获取华为 token 失败'));
          } catch (e) {
            reject(new Error('解析华为 OAuth 响应失败: ' + data));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 华为 Push Kit：发送消息到单设备
 * 文档：https://developer.huawei.com/consumer/en/doc/HMSCore-References-V5/send-message-000105318-V5
 */
async function sendHuaweiPush(accessToken, appId, deviceToken, title, body, customData) {
  const message = {
    validate_only: false,
    message: {
      notification: { title: title || '测试推送', body: body || '这是一条测试消息' },
      android: {
        urgency: 'NORMAL',
        ttl: '86400s',
        notification: { title: title || '测试推送', body: body || '这是一条测试消息', click_action: { type: 3 } },
      },
      token: [deviceToken.trim().replace(/\s/g, '')],
    },
  };
  if (customData && typeof customData === 'object' && Object.keys(customData).length > 0) {
    message.message.data = {};
    for (const [k, v] of Object.entries(customData)) {
      message.message.data[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
  const bodyStr = JSON.stringify(message);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'push-api.cloud.huawei.com',
        path: `/v1/${appId}/messages:send`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.msg || json.error?.message || data || `HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error('解析华为推送响应失败: ' + data));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// 发送推送 API（支持 platform: 'ios' | 'android' | 'huawei'）
app.post('/api/send', async (req, res) => {
  const platform = (req.body.platform || 'ios').toLowerCase();

  try {
    if (platform === 'huawei') {
      // ---------- 华为 (Push Kit) ----------
      const { clientId, clientSecret, appId, deviceToken, title, body, customData } = req.body;
      if (!deviceToken || !clientId || !clientSecret) {
        return res.status(400).json({
          success: false,
          error: '缺少必要参数：clientId, clientSecret, deviceToken',
        });
      }
      const appIdVal = (appId || clientId || '').toString().trim();
      if (!appIdVal) {
        return res.status(400).json({
          success: false,
          error: '缺少 Application ID（可与 Client ID 相同）',
        });
      }
      const accessToken = await getHuaweiAccessToken(clientId, clientSecret);
      const result = await sendHuaweiPush(accessToken, appIdVal, deviceToken, title, body, customData);
      return res.json({
        success: true,
        message: '推送发送成功',
        messageId: result.requestId || result.msg,
      });
    }

    if (platform === 'android') {
      // ---------- Android (FCM) ----------
      const {
        serviceAccountJson,
        deviceToken,
        title,
        body,
        customData,
      } = req.body;

      if (!deviceToken || !serviceAccountJson) {
        return res.status(400).json({
          success: false,
          error: '缺少必要参数：deviceToken, FCM 服务账号 JSON',
        });
      }

      const app = getFcmApp(
        typeof serviceAccountJson === 'string' ? serviceAccountJson : JSON.stringify(serviceAccountJson)
      );
      const messaging = app.messaging();

      const message = {
        token: deviceToken.trim().replace(/\s/g, ''),
        notification: {
          title: title || '测试推送',
          body: body || '这是一条测试消息',
        },
      };
      if (customData && typeof customData === 'object' && Object.keys(customData).length > 0) {
        const data = {};
        for (const [k, v] of Object.entries(customData)) {
          data[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        message.data = data;
      }

      const messageId = await messaging.send(message);
      return res.json({
        success: true,
        message: '推送发送成功',
        messageId,
      });
    }

    // ---------- iOS (APNs) ----------
    const {
      p12Data,
      passphrase,
      bundleId,
      deviceToken,
      title,
      body,
      production = false,
      badge,
      sound = 'default',
      customData,
    } = req.body;

    if (!deviceToken || !p12Data || !bundleId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数：deviceToken, P12 证书, bundleId',
      });
    }

    const p12Buffer = Buffer.from(p12Data, 'base64');
    const configKey = crypto.createHash('md5').update(p12Buffer).digest('hex') + '-' + production;

    if (!apnProvider || lastConfig !== configKey) {
      if (apnProvider) {
        apnProvider.shutdown();
      }
      apnProvider = createProvider({
        p12Buffer,
        passphrase: passphrase || '',
        bundleId,
        production,
      });
      lastConfig = configKey;
    }

    const notification = new apn.Notification();
    notification.topic = bundleId;
    notification.pushType = 'alert';
    notification.alert = { title: title || '测试推送', body: body || '这是一条测试消息' };
    notification.sound = sound;
    if (badge !== undefined && badge !== null) notification.badge = parseInt(badge, 10);
    if (customData && typeof customData === 'object') {
      notification.payload = customData;
    }

    const result = await apnProvider.send(notification, deviceToken);

    if (result.sent.length > 0) {
      res.json({
        success: true,
        message: '推送发送成功',
        sent: result.sent,
      });
    } else if (result.failed.length > 0) {
      const failure = result.failed[0];
      res.status(400).json({
        success: false,
        error: failure.response?.reason || failure.error?.message || '推送发送失败',
      });
    } else {
      res.json({
        success: true,
        message: '推送已加入队列',
      });
    }
  } catch (err) {
    console.error('推送错误:', err);
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'iOS / Android / 华为 推送测试后台' });
});

app.listen(PORT, () => {
  console.log(`\n📱 iOS / Android / 华为 推送测试后台已启动`);
  console.log(`   访问: http://localhost:${PORT}\n`);
});
