# PushConsole

用于测试移动端推送的本地网页后台，支持 **iOS (APNs)**、**Android (FCM)** 与 **华为 (Push Kit)**。

## 功能

- 本机运行，通过浏览器配置并发送推送
- **iOS**：支持 APNs 沙盒与生产环境切换，使用 P12 证书，自动转 PEM
- **Android**：使用 Firebase Cloud Messaging (FCM)，上传服务账号 JSON 即可发送
- **华为**：使用华为 Push Kit（HMS），填写 Client ID / Client Secret 即可向华为/荣耀设备推送

## 技术栈

- **Node.js** + **Express**
- [node-apn](https://github.com/node-apn/node-apn)（APNs）
- [firebase-admin](https://firebase.google.com/docs/admin/setup)（FCM）
- 华为 Push Kit（REST API，OAuth2 + 发送接口）

## 前置要求

1. **Node.js** 14+
2. **iOS**：Apple Developer 账号，并已创建 APNs 证书（开发/生产）及 App 的 **Bundle ID**
3. **Android**：Firebase 项目，并已启用 Cloud Messaging API，下载**服务账号 JSON**（私钥）
4. **华为**：华为开发者账号，在 AppGallery Connect 创建应用并开通 **Push Kit**，获取 **Client ID** 与 **Client Secret**

## 安装与运行

```bash
git clone git@github.com:DeTong/PushConsole.git
cd PushConsole
npm install
npm start
```

浏览器访问：<http://localhost:3000>

## 配置说明

### iOS (APNs)

| 配置项 | 说明 |
|--------|------|
| P12 证书 | 点击选择从钥匙串导出的 `.p12` 文件 |
| P12 导出密码 | 导出时设置的密码，未设置则留空 |
| Bundle ID | 应用的 Bundle Identifier（需与 P12 证书对应） |
| 设备令牌 | iOS 应用通过 `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` 获取的 token |

- **沙盒 (Sandbox)**：开发/调试时使用，默认勾选
- **生产 (Production)**：正式环境，需勾选「生产环境」；开发和生产需使用**不同的 P12 证书**

### Android (FCM)

| 配置项 | 说明 |
|--------|------|
| 服务账号 JSON | 从 Firebase 控制台 → 项目设置 → 服务账号 → 生成新的私钥，下载的 `.json` 文件 |
| 设备令牌 | Android 应用通过 Firebase Messaging 获取的 FCM Registration Token |

### 华为 (Push Kit)

| 配置项 | 说明 |
|--------|------|
| Client ID | AppGallery Connect → 项目设置 → 应用 → 应用 ID |
| Client Secret | 同上，应用密钥（App secret） |
| Application ID | 选填，不填则使用 Client ID（一般与 Client ID 相同） |
| 设备令牌 | 华为/荣耀设备上集成 HMS Push Kit 后，通过 `onNewToken` 获取的 Push Token |

## 获取 P12 证书（iOS）

1. 在 [Apple Developer](https://developer.apple.com/) 创建 APNs 证书（开发或生产各需一个）
2. 下载 `.cer` 后双击导入钥匙串
3. 在「钥匙串访问」中找到该证书，右键 → 导出为 `.p12`
4. 设置导出密码（可选，建议设置）

## 获取 FCM 服务账号（Android）

1. 打开 [Firebase Console](https://console.firebase.google.com/)，选择项目
2. 项目设置（齿轮）→ **服务账号** → **生成新的私钥**
3. 下载得到的 `.json` 文件即为服务账号凭证，在页面上传该文件即可发送 FCM 推送
4. 需在 Firebase 中启用 **Cloud Messaging API**（新项目通常已默认启用）

## 获取华为 Push Kit 凭证

1. 打开 [AppGallery Connect](https://developer.huawei.com/consumer/cn/service/josp/agc/index.html)，登录华为开发者账号
2. 创建或选择项目，在项目中添加应用（Android），并开通 **Push Kit** 能力
3. 进入 **项目设置** → **应用**，在对应应用下查看 **应用 ID**（即 Client ID）和 **应用密钥**（即 Client Secret）
4. 设备端需集成 [HMS Core Push Kit](https://developer.huawei.com/consumer/cn/hms/huawei-pushkit)，在 `onNewToken` 回调中获取设备 Push Token，填入本后台即可发送测试推送

## 仓库

<https://github.com/DeTong/PushConsole>
