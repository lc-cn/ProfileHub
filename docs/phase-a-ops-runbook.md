# Phase A 运维与上线策略（Runbook）

本文档对齐 Issue #9：管理控制台 + 多租户 RBAC 主线在 **Phase A** 下的运维约定。产品范围见根目录 [`CONTEXT.md`](../CONTEXT.md) 与 [`governance-matrix.md`](governance-matrix.md)。


| 字段           | 说明                                      |
| ------------ | --------------------------------------- |
| **维护 Owner** | [admin@liucl.cn](mailto:admin@liucl.cn) |
| **当前版本**     | 0.5                                     |
| **最后更新**     | 2026-05-11                              |


---

## 1. 文档治理与验收登记

Issue #9 验收项中需**组织内人工**完成的部分，在此留痕；完成后可勾选。

- [x] **内部评审**：至少一次走读（安全 / 运维 / 工程），结论写入下表。
- [x] **恢复演练**：按 [§3](#3-备份与恢复-turso--libsql) 执行至少一次 **Turso PITR 全链路**演练，结果写入 [附录 A](#附录-a-恢复演练登记簿)（与下列「环境对表认可」不同）。
- [x] **生产环境变量**：已将 [§4](#4-环境变量策略) 与 **Vercel** 实际部署做键名级对表，结论记入 [附录 B](#附录-b-生产部署与仓库默认差异登记) 与 [§4.3](#vercel-env-snapshot)；**维护 Owner 已认可**（2026-05-11）。
- [x] **Issue #13（协作功能开关）**：**§4.2.2** 与附录 B 中 `FEATURE_*` 已与线上一致；维护 Owner 已认可（[#13](https://github.com/lc-cn/ProfileHub/issues/13)）。

### 本地协作：入库当天可完成的 4 步（与维护人一起）

不替代 Turso 真实演练，但能把文档推到「可评审、可跟踪」状态：

1. **填 Owner**：更新文首表格「维护 Owner」为真实责任人。
2. **填附录 B（不含密钥）**：对照部署面板或本机 `.env` / `.env.local` 的**键与取值意图**（如 `true` / `off` / 未设置），勿把 secret 写入 Git；若无独立 prod，在附录 B 末行备注「暂无 prod」并签日期。
3. **填附录 A 或占位**：若演练尚未执行，先在附录 A 新增一行写**计划演练窗口**与负责人；演练完成后改为真实结果行。
4. **约评审**：在「评审记录」表填入计划日期；走读后在同一行补全结论。

### 评审记录


| 版本  | 日期         | 评审参与方                                             | 结论                                                                         |
| --- | ---------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| 0.1 |            |                                                   |                                                                            |
| 0.2 |            |                                                   |                                                                            |
| 0.4 | 2026-05-11 | [admin@liucl.cn](mailto:admin@liucl.cn)（维护 Owner） | 已认可 `vercel env ls` 对表结论、§4.2.2 与附录 B；Turso PITR 全链路演练仍待执行后更新附录 A 与本行补充结论。 |
| 0.5 | 2026-05-11 | [admin@liucl.cn](mailto:admin@liucl.cn)（维护 Owner） | Issue #9 验收项全部勾选；附录 A 已登记 Turso PITR 全链路完成；本 runbook 结案。 |


---

## 2. Phase A 范围与「无行级审计」边界

- **不做**：面向合规的**行级操作审计**（谁在某租户内对哪一行做了何种变更的不可抵赖流水）。若后续需要，应单独立项（存储、保留期、查询与取证流程）。
- **可做且依赖**：
  - **应用日志**：HTTP 路径、状态码、`tenantId` / `userId` 等**已在代码中打点的字段**（具体以当前实现为准）；用于故障排查与粗粒度追溯。
  - **数据库状态**：以 Turso **按提交（COMMIT）** 的连续保护能力为主（见下节）；结合 PITR 可恢复到某一时间点前后的库快照（新建库并切换连接串）。
- **责任划分（叙述性）**：
  - **应用层**：访问控制拒绝、认证失败、显式审计类日志（若有）由应用与日志基础设施负责保留与检索。
  - **数据层**：误删、批量错误写入、迁移事故等，以 **备份 / PITR 恢复** 为主手段；**无法**用本仓库默认能力替代「逐 API 逐行」的监管审计。
- **事故响应（建议流程）**：确认影响范围 → 保全日志与当前连接信息 → 评估是否走 PITR 新建库 → 切换 `DATABASE_URL` / token → 根因分析与事后补丁（迁移/权限/开关）。

---

## 3. 备份与恢复（Turso / LibSQL）

本仓库默认数据面为 **Turso / LibSQL**（`libsql://`）。以下与 [Turso Point-in-Time Recovery 官方文档](https://docs.turso.tech/features/point-in-time-recovery) 对齐；**计费档位与保留窗口以你方 Turso 控制台与最新文档为准**。

### 3.1 备份频率与能力（叙述）

- Turso 在 **每次 `COMMIT`** 上形成可恢复基础；PITR 将库恢复到指定时间戳对应的状态（通过 **新建数据库** 完成，而非覆盖原库名）。
- 官方说明：所选时间戳前可能存在 **最多约 15 秒** 的数据间隙（与周期性 batch checkpoint 有关）。规划 RPO 时应把该间隙与业务写入峰值一并考虑。
- **免费 / Developer / Scaler / Pro** 等档位的 **可恢复时间窗口**（如文档所述的 24h / 10d / 30d / 90d）随计划变化，运维须在控制台确认当前组织与库的 **实际保留策略**。

### 3.2 RPO / RTO（与能力对齐的表述）


| 指标              | Phase A 建议表述                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **RPO（恢复点目标）**  | 在启用且付费档位覆盖的前提下，以 Turso PITR 为主：**通常可回到分钟级以内的时间点**；同时承认官方 **≤15s** 级别的前向间隙与计划窗口上限。若未购买足够保留期，RPO 退化为「仅窗口内可回滚」，超出则**不可恢复**，须在风险评估中写明。 |
| **RTO（恢复时间目标）** | 依赖：新建库耗时、生成新 token、修改部署环境变量、滚动重启或重新指向、应用侧缓存/session 失效处理。Phase A 建议按 **「尽力而为」+ 演练实测**：首次演练后在附录 A 填入实测分钟数。                          |


### 3.3 恢复演练步骤（可执行清单）

1. **事前**：在**非生产**或**专用演练库**上执行；记录当前 `DATABASE_URL` 对应库名、组织、计划档位。
2. **制造可观测变更**：写入一行明显标记的测试数据（如专用表或配置项），记录 UTC 时间 `T1`。
3. **执行 PITR**：按 Turso CLI 或 API，从源库 `--from-db` / `seed` 指定时间戳 `T0`（`T0` 早于 `T1`）创建新库（示例见官方文档 `turso db create ... --timestamp`）。
4. **验证**：用只读方式连接新库，确认测试数据是否存在/消失符合预期；检查配额与 token。
5. **回切策略（生产）**：演练结论应包含「如何在生产切换连接串」「旧库保留多久再删」「OAuth 客户端与密钥是否需同步更新」等（与你们部署平台相关）。
6. **登记**：将日期、结果、发现问题记入 [附录 A](#附录-a-恢复演练登记簿)。

### 3.4 应用侧 SQL / 迁移

- 空库或结构升级：`pnpm run db:apply-sql`（见 `[README.md](../README.md)`）。**对已有数据执行破坏性迁移前**须先按上节完成备份/PITR 演练意识与实际操作。
- 与 Turso 控制面 CLI 的交互（`turso db shell` 等）以官方文档为准。

---

## 4. 环境变量策略

下列变量在代码中的**未设置时的默认行为**与「关闭值」约定见 `src/lib/rbac-env.ts`、`src/lib/tenant-policy.ts`、`src/lib/wave3-env.ts` 及 `[.env.example](../.env.example)`。

**关闭值**（对 RBAC 与 FEATURE 类）：`0` / `false` / `no` / `off`（不区分大小写，trim 后比较）。  
`**ALLOW_SELF_SERVICE_TENANT_CREATE`**：仅当为上述关闭值之一时为禁止；**未设置或其它字符串视为允许**（与演示默认一致，生产须显式配置）。

### 4.1 各环境推荐默认值


| 变量                                 | dev（本地/实验）          | staging                  | prod                                                    |
| ---------------------------------- | ------------------- | ------------------------ | ------------------------------------------------------- |
| `ENFORCE_RBAC_ON_WRITE`            | `true`；仅排障时临时 `off` | `true`                   | `**true`**（非必要不设为关闭）                                    |
| `ALLOW_SELF_SERVICE_TENANT_CREATE` | 按需：`true` 便于联调      | 与 prod 策略一致或 `true` 用于验收 | `**false**`（或 `off`）：组织创建走审批/运维；若业务明确要求自助则 `true` 并记录风险 |
| `FEATURE_INVITES`                  | 按需                  | 与 prod 一致                | `**true**` 或 `**off**`：按是否上线邀请能力；关闭则相关 API 不可用          |
| `FEATURE_OWNER_TRANSFER`           | 按需                  | 与 prod 一致                | `**true**` 或 `**off**`：按是否上线 owner 移交；高敏环境可先 `off`      |


**变更审批**：生产对上述任一键的修改建议走变更单（谁改、为何、回滚值、预计窗口）；`ENFORCE_RBAC_ON_WRITE=off` 应视为 **高风险临时变更**，设时限与复盘。

**与 MFA 鼓励策略的衔接**：控制台 MFA 为「鼓励不强制」时，仍应通过 **全权限账号数量控制**、**离职立即禁用**、**密钥轮换** 降低单点风险（见下节）。

### 4.2 协作功能开关（Issue #13）

以下供 **发布 / 安全负责人** 书面确认后执行登记；与代码约定一致处见 `src/lib/wave3-env.ts`、根目录 `[.env.example](../.env.example)`：**未设置**时两开关均等价 `**true`（开启）**；`0` / `false` / `no` / `off` 为关闭，对应路由不可用。

#### 4.2.1 策略结论（Phase A 默认与例外）


| 维度             | 结论                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staging**    | 与 **生产** 保持一致，避免「预发有、线上无」导致验收失真。                                                                                                                                                                      |
| **生产默认**       | **开启**（不设或显式 `true`），与仓库代码默认一致；产品不要求多租户邀请/owner 移交、或安全基线要求 **缩小 HTTP 暴露面** 时，可显式 `**off`**。                                                                                                           |
| **关闭时（`off`）** | 生产不暴露相关 API；内部联调与演示使用 **dev / 独立预发** 或经变更单 **短时** 打开生产开关，避免依赖「无人知晓的生产幽灵能力」。                                                                                                                           |
| **开启时**        | 发起邀请与 owner **移交流程**以产品内角色为准（租户 **Owner**；若实现中含 `admin` 等扩展，以当前版本 UI/API 为准）；Phase A **无行级审计**（见 [§2](#2-phase-a-范围与无行级审计边界)），审计空窗期以 **变更单/工单编号** + **应用访问日志**（路径、时间、可追溯 request id，以实际打点为准）作为最低人工留痕。 |


#### 4.2.2 生产 / Staging 取值登记（须与线上一致）

以下取值由 `**vercel env ls`**（项目 `liucl/rbac-template`）于 **2026-05-11** 核对：**键名列表**中含 `FEATURE_INVITES` / `FEATURE_OWNER_TRANSFER` 的任意环境均未出现 → 在 Vercel 侧视为**未声明**，运行时按 `wave3-env.ts` **等价开启**（`true`）。与 [§4.3](#vercel-env-snapshot) 一致。


| 环境                          | `FEATURE_INVITES` | `FEATURE_OWNER_TRANSFER` | 确认人                                     | 日期         |
| --------------------------- | ----------------- | ------------------------ | --------------------------------------- | ---------- |
| **staging**（Vercel Preview） | 未声明（行为等价 `true`）  | 未声明（行为等价 `true`）         | [admin@liucl.cn](mailto:admin@liucl.cn) | 2026-05-11 |
| **prod**（Vercel Production） | 未声明（行为等价 `true`）  | 未声明（行为等价 `true`）         | [admin@liucl.cn](mailto:admin@liucl.cn) | 2026-05-11 |


填毕后须同步更新 [附录 B](#附录-b-生产部署与仓库默认差异登记) 中对应行，两处取值应一致。

#### 4.2.3 风险结论（一行）

**邀请令牌经邮件或中间人泄露、以及 owner 移交被误点或钓鱼，可导致非预期成员入租或租户控制权转移；** 缓解为强账号与 MFA 治理、最小化高权限账号、产品侧短效链接与明确二次确认，部署侧可 `**off` 完全关闭相关端点**。

#### 4.2.4 关闭态 HTTP 语义与回归（Issue #14）

`FEATURE_INVITES` / `FEATURE_OWNER_TRANSFER` 为 `**off`**（或其它关闭值）时，对应 HTTP API 返回 `**404**`，JSON 为 `{"error":"not_found"}`，属**刻意关闭后的预期语义**，不应按「路由未注册或应用损坏」升级事故。可勾选回归步骤与路径表见 `[wave3-features-disabled-regression.md](wave3-features-disabled-regression.md)`（[Issue #14](https://github.com/lc-cn/ProfileHub/issues/14)）。



### 4.3 Vercel 部署键名登记快照（CLI）

用于与附录 B 对表：**不记录** secret 明文；仅记录 `vercel env ls` 中出现的**变量名**与**绑定环境**（值为控制台所示 `Encrypted` 的不在此展开）。

**核对命令**：仓库根目录执行 `vercel env ls`（默认 Production）、`vercel env ls preview`、`vercel env ls development`。


| 变量名                                | Production | Preview | Development |
| ---------------------------------- | ---------- | ------- | ----------- |
| `DATABASE_URL`                     | 已配置        | 已配置     | 已配置         |
| `DATABASE_AUTH_TOKEN`              | 已配置        | 已配置     | 已配置         |
| `NEXTAUTH_URL`                     | 已配置        | 已配置     | 已配置         |
| `NEXTAUTH_SECRET`                  | 已配置        | 已配置     | 已配置         |
| `MFA_RECOVERY_LOG_ONLY`            | 已配置        | —       | —           |
| `MFA_TOTP_ISSUER`                  | 已配置        | —       | —           |
| `OAUTH_JWT_SECRET`                 | 已配置        | —       | —           |
| `RATE_LIMIT_PEPPER`                | 已配置        | —       | —           |
| `SECRETS_ENCRYPTION_KEY`           | 已配置        | —       | —           |
| `ENFORCE_RBAC_ON_WRITE`            | **未出现**    | **未出现** | **未出现**     |
| `ALLOW_SELF_SERVICE_TENANT_CREATE` | **未出现**    | **未出现** | **未出现**     |
| `FEATURE_INVITES`                  | **未出现**    | **未出现** | **未出现**     |
| `FEATURE_OWNER_TRANSFER`           | **未出现**    | **未出现** | **未出现**     |


**结论**：治理与第三波开关四类变量均依赖 **代码默认**；若需与 [§4.1](#41-各环境推荐默认值) 中 prod「推荐显式 `false`」对齐（如 `ALLOW_SELF_SERVICE_TENANT_CREATE`），须在 Vercel 中**显式新增**键值并由维护 Owner 更新附录 B。

---

## 5. 强账号治理

- **全权限 / owner 数量**：每个租户 **一名 owner**（数据模型约束）；`admin` 与平台 `isPlatformAdmin` 账号应最小化，定期复核名单。
- **离职与外包结束**：立即禁用账号、轮换其可见过的共享密钥；若曾接触 `client_secret` 或数据库 token，按轮换表执行。
- **密钥与 `client_secret`**：
  - `NEXTAUTH_SECRET` / `AUTH_SECRET`、`OAUTH_JWT_SECRET`、`SECRETS_ENCRYPTION_KEY`、`RATE_LIMIT_PEPPER`、Turso `DATABASE_AUTH_TOKEN`、OAuth 客户端密钥：纳入**轮换周期**（如 90 天或事故驱动），并记录上次轮换日期与执行人。
  - IdP 侧 RS256 私钥与 JWKS：轮换时需兼顾已签发令牌验证窗口与第三方依赖。
- **与 MFA 的关系**：在 MFA 非强制模式下，**密码 + Passkey 策略 + 上述治理** 共同构成 Phase A 的账号安全基线。

---

## 附录 A：恢复演练登记簿


| 类型             | 日期（UTC）    | 环境 / 范围                                   | 结果      | 发现问题与跟进                               | 执行人                                     |
| -------------- | ---------- | ----------------------------------------- | ------- | ------------------------------------- | --------------------------------------- |
| 环境变量对表（非 PITR） | 2026-05-11 | Vercel Production / Preview / Development | **已认可** | `vercel env ls` 键名级核对；与附录 B、§4.2.2 一致 | [admin@liucl.cn](mailto:admin@liucl.cn) |
| Turso PITR 全链路 | 2026-05-11 | Turso（演练库或 §3.3 约定库） | **已完成** | 按 §3.3 全链路演练成功；无待跟进项 | [admin@liucl.cn](mailto:admin@liucl.cn) |


---

## 附录 B：生产部署与仓库默认差异登记

将线上实际值与 [§4](#4-环境变量策略)（含 [§4.2](#42-协作功能开关-issue-13) 登记表）对比，差异记于此（无则写「无差异」并由 Owner 签字日期）。**生产键名级对表**见 [§4.3](#vercel-env-snapshot)（`vercel env ls`，2026-05-11）。


| 变量                                 | 仓库/代码默认（未设置时） | 生产实际值（Vercel 侧）        | 差异原因与批准人                                                                                                    | 登记日期       |
| ---------------------------------- | ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| `ENFORCE_RBAC_ON_WRITE`            | 等价 `true`     | **未声明** → 运行时效价 `true` | 与代码默认一致                                                                                                     | 2026-05-11 |
| `ALLOW_SELF_SERVICE_TENANT_CREATE` | 允许            | **未声明** → 运行时允许        | 与 §4.1 prod「推荐显式 `false`」不一致；当前采纳未声明默认；收紧时须 Vercel 显式 `off` 并由 [admin@liucl.cn](mailto:admin@liucl.cn) 更新本行 | 2026-05-11 |
| `FEATURE_INVITES`                  | 等价 `true`     | **未声明** → 运行时效价 `true` | 与 §4.2.2 登记一致                                                                                               | 2026-05-11 |
| `FEATURE_OWNER_TRANSFER`           | 等价 `true`     | **未声明** → 运行时效价 `true` | 与 §4.2.2 登记一致                                                                                               | 2026-05-11 |


**维护 Owner 认可（附录 B）**：已于 **2026-05-11** 对表 `vercel env ls` 与上表一致；策略差异行（`ALLOW_SELF_SERVICE_TENANT_CREATE`）已知悉。—— [admin@liucl.cn](mailto:admin@liucl.cn)

---

## 参考链接

- Turso PITR：[https://docs.turso.tech/features/point-in-time-recovery](https://docs.turso.tech/features/point-in-time-recovery)
- 治理矩阵：[`docs/governance-matrix.md`](governance-matrix.md)
- 领域词汇：[`CONTEXT.md`](../CONTEXT.md)
- 第三波功能开关关闭时的 API 与回归清单：[`wave3-features-disabled-regression.md`](wave3-features-disabled-regression.md)（[Issue #14](https://github.com/lc-cn/ProfileHub/issues/14)）

