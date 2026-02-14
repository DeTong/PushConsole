const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const apn = require('apn');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 存储 APNs Provider 实例（按配置缓存）
let apnProvider = null;
let lastConfig = null;

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

// 发送推送 API
app.post('/api/send', async (req, res) => {
  try {
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
  res.json({ status: 'ok', service: 'iOS Push Test Backend' });
});

app.listen(PORT, () => {
  console.log(`\n📱 iOS 推送测试后台已启动`);
  console.log(`   访问: http://localhost:${PORT}\n`);
});
