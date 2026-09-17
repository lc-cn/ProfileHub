# ProfileHub

**为多个应用提供统一账号、组织与访问权限管理。**

ProfileHub 是可自行部署的身份与权限管理平台。你可以集中维护用户、组织、角色和应用，并通过 OAuth 2.0 / OpenID Connect 授权码流程，让业务网站接入同一套账号体系。

[客户端接入](docs/oauth-better-auth.md) · [权限模型](docs/governance-matrix.md) · [Issues](https://github.com/lc-cn/ProfileHub/issues) · [Apache-2.0](LICENSE)

## 能做什么

| 能力 | 当前实现 |
| --- | --- |
| 账号与安全 | 邮箱密码登录、Passkey、TOTP 多因素认证及恢复流程 |
| 组织管理 | 多租户、成员邀请、owner/admin/member 治理角色、所有者移交、租户暂停与归档 |
| 业务权限 | 按应用和功能维护权限，给用户分配角色，检查租户内资源访问权限 |
| 应用接入 | 管理 OAuth 客户端、精确回调白名单、允许的 scope 和授权类型 |
| OAuth / OIDC | 授权码、PKCE S256、同意页、Discovery、RS256 ID Token、JWKS、UserInfo |
| Token 与退出 | Refresh Token 轮换与重放检测、刷新令牌吊销、Token 自省、RP 发起退出 |
| 管理界面 | 用户、角色、权限、应用和系统配置；中英文与主题切换 |

组织治理和业务 RBAC 分别管理“谁能管理组织”与“谁能访问业务资源”。具体规则见 [权限矩阵](docs/governance-matrix.md)。

## 与 AccessHub 一起使用

[AccessHub](https://github.com/lc-cn/AccessHub) 管理 API 服务、调用凭据、配额与订阅权益；ProfileHub 提供身份和组织管理。两者可以独立部署，也可以通过 OIDC 连接：

```text
用户 → ProfileHub 登录并同意授权 → AccessHub 建立本地会话 → 访问 API 服务
```

OIDC 接入传递用户身份，不会自动同步两个系统的业务角色、订阅或 API 权限。其他支持相应 OAuth/OIDC 流程的应用也可以接入，Better Auth 的配置示例见 [接入指南](docs/oauth-better-auth.md)。

## 本地开发

准备 Node.js 24、pnpm，以及一个独立的 LibSQL 数据库（例如 Turso）。当前数据库适配要求 `libsql://` 地址，不直接支持 `file:` 本地 SQLite。

```bash
git clone https://github.com/lc-cn/ProfileHub.git
cd ProfileHub
pnpm install
```

在根目录创建 `.env.local`，填入自己的配置：

```dotenv
DATABASE_URL=libsql://your-database.example
DATABASE_AUTH_TOKEN=your-database-token
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-a-random-secret
SECRETS_ENCRYPTION_KEY=replace-with-64-hex-characters
RATE_LIMIT_PEPPER=replace-with-another-64-hex-characters
```

`NEXTAUTH_SECRET` 使用独立的强随机值；后两个变量各使用 32 字节随机数据的十六进制表示。不要使用同一个值，也不要提交环境文件。

为 OIDC 生成 RSA 签名密钥，再初始化**空的开发数据库**：

```bash
pnpm run oauth:generate-key
pnpm run db:apply-sql
pnpm run seed
pnpm dev
```

打开 <http://localhost:3000>。密钥脚本生成 3072 位 RSA 私钥并写入 `.env.local`，已有私钥时不会覆盖。生产环境应单独生成密钥，详见 [RSA 配置](docs/oauth-better-auth.md#生成与配置-rsa-私钥)。

种子数据包含管理员 `admin@example.com` / `admin123`，以及使用公开演示密钥的 OAuth 客户端 `rbac_demo_client`。这些数据仅用于开发；对外开放前必须修改管理员密码并删除或重新配置演示客户端。

已有数据库请先阅读 [迁移说明](sql/migrations/README.md)。建表脚本对部分旧版 OAuth 客户端表存在重建逻辑，不能当作无损升级命令直接运行。

## 部署

可构建后以 Node.js 运行，也可部署到 Vercel。数据库使用独立的 LibSQL 服务。

```bash
pnpm build
pnpm start
```

部署时配置自己的 HTTPS 站点地址、数据库连接、会话密钥、敏感字段加密密钥及限流 pepper。OIDC 还需要 `OAUTH_RSA_PRIVATE_KEY_B64` 或 `OAUTH_RSA_PRIVATE_KEY_PEM`；Issuer 默认使用 `NEXTAUTH_URL`，需要不同地址时配置 `OAUTH_ISSUER_URL`。

在管理界面为业务应用登记客户端与完整回调地址。业务网站只持有自己的客户端凭据，通过 JWKS 获取公钥，不持有 ProfileHub 的 RSA 私钥。

部署后可通过 `/docs` 和 `/docs/oauth2` 查看无需登录的接入文档。

## 协议范围

- 支持机密客户端，以及强制使用 PKCE S256 的公开客户端。
- OIDC 必须配置 RSA，缺失或无效时不会降级为未验证的身份流程。
- 吊销针对 Refresh Token；已签发的 JWT Access Token 不支持即时吊销。
- RP 发起退出会清理本应用与 IdP 的对应会话流程，不提供所有业务网站的全局单点退出。
- 当前采用单个 RSA 签名密钥，尚无自动轮换及旧公钥重叠窗口。
- 尚未实现动态客户端注册、`client_credentials`、设备授权、`private_key_jwt` 或 SAML，也不宣称通过 OIDC 一致性认证。

完整行为、兼容性验证及限制见 [OAuth / Better Auth 文档](docs/oauth-better-auth.md)。

## 开发与贡献

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 生产构建 |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` | 单元与协议测试 |
| `pnpm test:oauth` | OAuth 服务端测试 |

核心代码位于 `src/lib/oauth2/`（协议）、`src/lib/data-access.ts`（数据访问）和 `src/app/`（页面与接口）；数据库结构与增量迁移位于 `sql/`。

欢迎通过 Issue 描述问题与使用场景，通过 Pull Request 提交改进。涉及认证、权限和数据迁移的修改，请附复现步骤、测试和兼容性说明。请勿在公开 Issue 中提交密码、私钥、Token 或用户数据。

## 许可证

Copyright 2026 ProfileHub contributors.

本项目采用 [Apache License 2.0](LICENSE)。第三方依赖遵循各自的许可证。
