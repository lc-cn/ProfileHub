# Better Auth 接入与 OAuth Server 行为

本项目以 NextAuth 维护登录会话，自建 OAuth/OIDC Server 对外提供身份。业务网站可通过 Better Auth 的 Generic OAuth 插件接入，无需替换本项目的认证框架。

## 部署与升级

- 配置 `OAUTH_ISSUER_URL`（或 `NEXTAUTH_URL`）为 IdP 的外部根地址，生产使用 HTTPS。
- OIDC 现在必须配置至少 2048 位的 RSA PKCS8 私钥，变量为 `OAUTH_RSA_PRIVATE_KEY_PEM`，或 PEM 的 Base64 编码 `OAUTH_RSA_PRIVATE_KEY_B64`。B64 优先。配置错误会失败，不静默降级。私钥应在部署环境的 Secret 管理中保存。
- 配置强随机 `NEXTAUTH_SECRET`，用于控制台会话及短期登出回调票据。所有实例保持一致。
- 此次不增加数据库表；复用现有 `OAuth2RefreshToken.replacedById`。旧库须已应用 migration 003 或当前 schema。
- 原 HS256 ID Token 不再继续签发，也不能作为新的 logout hint。升级后客户端应重新登录。
- RSA 目前使用单个签名密钥；更换密钥没有旧公钥重叠窗口，须协调客户端缓存及有效 Token 生命周期。

在控制台的应用配置中创建机密客户端，登记业务网站的完整回调地址：

`https://app.example.com/api/auth/callback/rbac`

允许 `openid profile email`，需要刷新时再允许 `offline_access` 并启用 refresh_token grant。登记所需登出回调，例如 `https://app.example.com/login`。

## 生成与配置 RSA 私钥

在 ProfileHub 根目录运行：

```bash
pnpm run oauth:generate-key
```

命令生成 **3072 位 RSA、PKCS8 PEM**，转成单行 Base64 后写入 `.env.local` 的 `OAUTH_RSA_PRIVATE_KEY_B64`，文件权限设为 `600`。已有 RSA 私钥时拒绝覆盖；不会输出私钥。`.env.local` 已被 Git 忽略。也可指定另一个受保护的环境文件：

```bash
node scripts/generate-oauth-key.mjs /private/tmp/idp-keys.env
```

生成使用 Node.js 的 [generateKeyPairSync](https://nodejs.org/api/crypto.html#cryptogeneratekeypairsynctype-options)。Base64 仅用于方便环境变量配置，不是加密。

- **本地**：Next.js 启动时读取 `.env.local`，修改后重启 IdP。
- **部署**：将该文件中 `OAUTH_RSA_PRIVATE_KEY_B64=` 后的整行值复制到 IdP 部署项目的同名服务端环境变量，再重新部署。不要带变量名前缀或额外引号。生产环境应单独生成并保存一把密钥，不复用测试密钥。
- **客户端 l2cl**：不配置 RSA 私钥，也不需要手动复制公钥。它从 Discovery 的 `jwks_uri` 自动获取公钥进行验签。
- **两个 Secret 不同**：`NEXTAUTH_SECRET` 保护 IdP 会话；`RBAC_CLIENT_SECRET` 是控制台给 l2cl 注册的客户端密钥；二者均不是 RSA 私钥。

启动 IdP 后验证以下公开端点：

```bash
curl --fail http://localhost:3000/.well-known/openid-configuration
curl --fail http://localhost:3000/.well-known/jwks.json
```

第一项应包含 `jwks_uri` 和 RS256，第二项应包含 RSA 公钥的 `n`、`e`、`kid`；不会包含私钥参数 `d`。

## 与 lc-cn/AccessHub 联调

本机目录为 `/Users/liuchunlang/l2cl`，已安装 Better Auth 1.7.4。新增 `lib/rbac-oauth.ts`，只有三项 RBAC 环境变量完整配置后才注册 provider 并显示“使用统一账号登录”。GitHub / 爱发电保持原配置；账号仍禁止隐式合并，不会按同邮箱自动链接旧账号。

建议本地端口如下：

| 配置 | ProfileHub（IdP） | AccessHub（业务网站） |
| --- | --- | --- |
| 地址 | `http://localhost:3000` | `http://localhost:3001` |
| 启动 | `pnpm dev --port 3000` | `pnpm dev --port 3001` |
| 站点环境变量 | `NEXTAUTH_URL=http://localhost:3000`、`OAUTH_ISSUER_URL=http://localhost:3000` | `BETTER_AUTH_URL=http://localhost:3001` |

IdP 另需自己的测试 Turso 数据库连接和 `NEXTAUTH_SECRET`；本次生成脚本只配置 RSA，不自动选择数据库。不要把 l2cl 的 PostgreSQL 连接填给 IdP。

在 IdP 控制台给 l2cl 创建机密客户端：

- redirect URI：`http://localhost:3001/api/auth/callback/rbac`
- post-logout redirect URI：`http://localhost:3001/login`
- scopes：`openid profile email offline_access`
- grants：authorization_code 和 refresh_token

把控制台产生的客户端凭据放入 l2cl 的 `.env.local`：

```dotenv
BETTER_AUTH_URL=http://localhost:3001
RBAC_ISSUER_URL=http://localhost:3000
RBAC_CLIENT_ID=控制台生成的client_id
RBAC_CLIENT_SECRET=控制台一次性展示的client_secret
```

先启动 IdP 并确认 Discovery 正常，再启动/重启 l2cl；Better Auth 在初始化时执行 Discovery。浏览器进入 l2cl `/login`，选择统一账号，完成 IdP 登录及同意后返回。退出登录会进入 IdP 确认页，然后返回 l2cl `/login`。

可重复执行隔离协议联调（在 ProfileHub 中）：

```bash
L2CL_PATH=/Users/liuchunlang/l2cl pnpm run test:oauth
```

联调加载 l2cl 实际安装的 Better Auth 和 `lib/rbac-oauth.ts` 配置，覆盖 Discovery → PKCE/nonce → 同意 → JWKS 验签 → 创建会话 → 刷新 → RP 登出。测试使用临时 LibSQL 和 Better Auth 内存适配器，HTTP fetch 转发到真实 IdP Route Handler；不连接外部服务，不使用两边生产数据库。该测试不覆盖浏览器渲染、网络代理、l2cl PostgreSQL hook 或实际部署 Cookie 行为。

Better Auth 1.7.4 的 `/refresh-token` 使用账号记录的 `accountId`，不是 `providerId`。联调已按安装版本验证。

## Better Auth 客户端示例

以下选项对照 Better Auth 当前 [Generic OAuth 官方文档](https://better-auth.com/docs/plugins/generic-oauth)。请在客户端锁定版本后验证其配置类型。

```ts
import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'

export const auth = betterAuth({
  baseURL: 'https://app.example.com',
  // 保留业务网站自己的 database 等配置。
  plugins: [
    genericOAuth({
      config: [{
        providerId: 'rbac',
        clientId: process.env.RBAC_CLIENT_ID!,
        clientSecret: process.env.RBAC_CLIENT_SECRET!,
        discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
        requireIdTokenVerification: true,
        pkce: true,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        postLogoutRedirectURI: 'https://app.example.com/login',
      }],
    }),
  ],
})
```

不要将机密客户端 Secret 放进浏览器。公开客户端使用 PKCE S256 并省略 client_secret。ID Token 和 UserInfo 返回一致的 sub；email_verified 来自用户的真实 emailVerified 字段，不会因用户存在就标为已验证。

## 协议行为

- Discovery 宣告 RS256、JWKS、S256、query 响应模式，以及 basic/post/none 客户端认证。
- 授权成功和错误回跳包含 RFC 9207 `iss`；同意页 POST 通过 303 变为客户端 GET 回调。Consent POST 校验 Origin。
- 客户端认证先于授权码消费；code、client、redirect URI、PKCE 全部匹配后，原子删除保证只能兑换一次。
- Refresh Token 轮换使用事务，旧值失效与新值入库同时成功。过期时间沿用首次签发时间；scope 只能缩减，不能扩大。
- 再次使用已轮换 Token 会吊销其后续刷新令牌。没有并发重试宽限窗口；客户端应串行刷新，收到 invalid_grant 后重新登录。
- `/oauth/revoke` 要求客户端身份且只处理该客户端的 Refresh Token 及后续轮换令牌。JWT Access Token 不支持即时吊销；显式 `token_type_hint=access_token` 返回 unsupported_token_type，已签发 Access Token 仍可使用到过期。
- `/oauth/introspect` 仅允许机密客户端检查自己的 Token；禁用用户的 Token 返回 inactive。
- `/oauth/logout` 支持 client_id 或已验证的 id_token_hint（允许过期的有效签名 ID Token），校验登记回调后进入 Auth.js 确认页。清除会话后经本站签名票据回调再回到外站并返回 state；不传回调仍会登出。登出不吊销现有 OAuth Token，也不清除其他 RP 的本地会话。
- 支持交互式 consent。prompt=none 返回 consent_required；其他 prompt、非 query response_mode 明确拒绝，不假装完成强制重新认证。

## 验证与边界

`pnpm run test:oauth` 使用临时本地 LibSQL 数据库，测试真实 Route Handler、RSA/JWKS 验签、nonce、公开/机密客户端、授权码并发消费、Refresh 轮换与重放、客户端隔离、Consent 回跳和登出票据。只有登录会话读取被替换为测试会话，不连接生产数据库。

测试使用 Node 24 的模块解析钩子及实验性模块 mock。`pnpm test` 包含 OAuth 测试及原有测试。

这不是完整 OAuth Provider 产品对等实现。尚未实现 client_credentials、动态客户端注册、resource audience、private_key_jwt、自动同意持久化、prompt=login/select_account，以及 JWT 即时吊销。已完成下述生产 HTTP 链路验收；浏览器目前仅确认登录入口渲染，尚未完成完整浏览器点击式 E2E。本地及生产冒烟测试不等于 OIDC 认证或远程 Turso 并发压力验收。

## 生产部署记录（2026-09-17）

- IdP：`https://auth.liucl.cn`，Vercel 项目 `liucl/rbac-template`。
- RP：`https://l2cl.link`，Cloudflare Worker `accesshub`。
- Client ID：`l2cl-production`。
- Callback：`https://l2cl.link/api/auth/callback/rbac`。
- Logout callback：`https://l2cl.link/login`。
- 生产 RSA 单独生成，保存在 Vercel 的生产 Secret `OAUTH_RSA_PRIVATE_KEY_B64`；本机恢复副本是 Git 忽略的 `.env.oauth-production.local`（600 权限）。不要用开发 `.env.local` 的 RSA 替换它。
- 客户端配置在 Cloudflare 运行时 Secret：`RBAC_ISSUER_URL`、`RBAC_CLIENT_ID`、`RBAC_CLIENT_SECRET`，没有写入 l2cl 的本地数据库配置。
- 发布前 IdP 回滚版本：`https://rbac-template-ck6ga19in-liucl.vercel.app`；RP 回滚版本：`261a86d4-fd6d-4e98-8323-83fd49e4c806`。新增 RBAC Secret 不被旧版代码使用；回滚应用不要删除现有数据库数据或重置会话密钥。

### 发布和实测结果

- IdP 发布：`rbac-template-a92qy1azl-liucl.vercel.app`，已绑定 `auth.liucl.cn`。
- RP 发布：Worker `accesshub`，版本 `e3a2677f-94ba-47a0-a783-cb782571d973`。
- 生产发现并修复：Better Auth 在创建实例时执行 Discovery；Cloudflare Workers 不允许模块全局初始化期间发起网络请求。l2cl 改为首次请求时创建并缓存 Auth 实例，避免 Provider 被初始化失败永久跳过。保留 `requireIdTokenVerification: true`。
- 真实 HTTPS 请求验证：IdP 凭据登录、Discovery/JWKS、PKCE/nonce、同意页及 303 回调、Better Auth 建号/会话、PostgreSQL 建号 hook/默认 API Key、Refresh 轮换、UserInfo、RP 退出、IdP 确认退出及带 state 的返回，全部通过。
- 使用独立 Cookie 容器和专用非管理员测试账号，没有操作已有浏览器账号。浏览器确认“使用统一账号登录”入口可见；上述完整链路由 HTTP 脚本执行。
- 测试后已禁用 IdP 测试账号、销毁测试密码、撤销其刷新令牌，删除 RP 测试账号及其 Account/Session/API Key。正式客户端及生产密钥保留。
