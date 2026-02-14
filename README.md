# PushConsole

用于测试移动端推送的本地网页后台，当前支持 **iOS (APNs)**，后续计划支持 Android (FCM) 等。

## 功能

- 本机运行，通过浏览器配置并发送推送
- 支持 APNs 沙盒与生产环境切换
- 使用 P12 证书，自动转 PEM，兼容常见 Node/OpenSSL 环境

## 技术栈

- **Node.js** + **Express**
- [node-apn](https://github.com/node-apn/node-apn)（APNs）

## 前置要求

1. **Node.js** 14+
2. **Apple Developer 账号**，并已创建：
   - APNs 证书（开发/生产）
   - App 的 **Bundle ID**

## 安装与运行

```bash
git clone git@github.com:DeTong/PushConsole.git
cd PushConsole
npm install
npm start
```

浏览器访问：<http://localhost:3000>

## 配置说明

| 配置项 | 说明 |
|--------|------|
| P12 证书 | 点击选择从钥匙串导出的 `.p12` 文件 |
| P12 导出密码 | 导出时设置的密码，未设置则留空 |
| Bundle ID | 应用的 Bundle Identifier（需与 P12 证书对应） |
| 设备令牌 | iOS 应用通过 `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` 获取的 token |

## 环境

- **沙盒 (Sandbox)**：开发/调试时使用，默认勾选
- **生产 (Production)**：正式环境，需要勾选「生产环境」
- 开发和生产需使用**不同的 P12 证书**

## 获取 P12 证书

1. 在 [Apple Developer](https://developer.apple.com/) 创建 APNs 证书（开发或生产各需一个）
2. 下载 `.cer` 后双击导入钥匙串
3. 在「钥匙串访问」中找到该证书，右键 → 导出为 `.p12`
4. 设置导出密码（可选，建议设置）

## 仓库

<https://github.com/DeTong/PushConsole>
