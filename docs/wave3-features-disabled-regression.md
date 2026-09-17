# FEATURE_INVITES / FEATURE_OWNER_TRANSFER 关闭时的行为与回归清单

本文档对齐 [GitHub Issue #14](https://github.com/lc-cn/ProfileHub/issues/14)：当第三波协作相关开关为**关闭**时，说明 API 的**预期**响应，并提供可勾选的短回归清单，避免将「功能刻意关闭」误报为故障。

**交叉引用**

- Phase A 运维与环境变量策略：[`docs/phase-a-ops-runbook.md`](phase-a-ops-runbook.md)（Issue [#9](https://github.com/lc-cn/ProfileHub/issues/9)），尤其 [§4 环境变量策略](phase-a-ops-runbook.md#4-环境变量策略)、[§4.2 协作功能开关](phase-a-ops-runbook.md#42-协作功能开关-issue-13)、[§4.2.4 关闭态 HTTP 语义](phase-a-ops-runbook.md#424-关闭态-http-语义与回归-issue-14) 与附录 B。
- 生产是否暴露上述能力的书面结论：Issue [#13](https://github.com/lc-cn/ProfileHub/issues/13)；**各环境实际取值须与 #13 结论及附录 B 登记一致**。若 #13 结论为「开启」，仍可用文末 **开启路径 smoke** 做发布验证；若「关闭」或部分关闭，以本文 **关闭路径** 为准。

---

## 1. 开关如何判定为关闭

实现见 `src/lib/wave3-env.ts`：`FEATURE_INVITES`、`FEATURE_OWNER_TRANSFER` 在**未设置**时等价开启；仅当值为（trim 后、不区分大小写）`0`、`false`、`no`、`off` 之一时为关闭。

---

## 2. 关闭时的 HTTP 与 JSON 约定

以下路由在对应开关为**关闭**时，应返回 **`404 Not Found`**，且响应体为 JSON：`{ "error": "not_found" }`。这是**预期行为**，不是网关或应用未注册路由。

| 开关关闭 | 方法 | 路径 |
|----------|------|------|
| `FEATURE_INVITES` | `GET` | `/api/tenants/{tenantId}/invitations` |
| `FEATURE_INVITES` | `POST` | `/api/tenants/{tenantId}/invitations` |
| `FEATURE_INVITES` | `POST` | `/api/invitations/accept` |
| `FEATURE_OWNER_TRANSFER` | `POST` | `/api/tenants/{tenantId}/owner-transfer` |
| `FEATURE_OWNER_TRANSFER` | `POST` | `/api/tenants/{tenantId}/owner-transfer/confirm` |

**鉴权顺序说明**：部分路由会先校验会话再返回 `404`（例如 `accept` 在未登录时仍可能先返回 `401`）；**在已具备合法会话且开关关闭的前提下**，上述路径应以 `404` + `not_found` 为预期。

**UI**：当前管理控制台未挂载独立「邀请 / 移交」入口时，无额外隐藏项；若后续增加入口，产品应选择在开关关闭时隐藏或展示「未启用」，并与本文档一致。

---

## 3. 关闭路径 — 短回归清单（可勾选）

在目标环境将 `FEATURE_INVITES` 和/或 `FEATURE_OWNER_TRANSFER` 设为关闭后重启应用，使用**有效租户上下文与会话**（及 owner 账号，若测移交）执行：

**`FEATURE_INVITES=off`**

- [ ] `GET /api/tenants/{tenantId}/invitations` → `404`，body 含 `"error":"not_found"`。
- [ ] `POST /api/tenants/{tenantId}/invitations`（合法 JSON body）→ `404`，`not_found`。
- [ ] `POST /api/invitations/accept`（带 `token`）在**已登录业务会话**下 → `404`，`not_found`。

**`FEATURE_OWNER_TRANSFER=off`**

- [ ] `POST /api/tenants/{tenantId}/owner-transfer`（合法 body）→ `404`，`not_found`。
- [ ] `POST /api/tenants/{tenantId}/owner-transfer/confirm`（合法 body）→ `404`，`not_found`。

**烟雾**：同一环境下将开关恢复为开启（或取消变量使用默认开启），重复上述请求中至少一条，应**不再**因「功能关闭」单独返回 `404`（仍可能因权限、校验失败返回其它 4xx）。

---

## 4. 开启路径 — 极简 smoke（#13 结论为开启或联调时）

- [ ] `GET /api/tenants/{tenantId}/invitations` 在具备 `USER_READ` 时返回 `200` 与列表结构（可为空数组）。
- [ ] `POST /api/tenants/{tenantId}/invitations` 在 owner/admin 与治理允许时返回 `201` 或约定成功结构（以当前实现为准）。
- [ ] `POST /api/invitations/accept` 使用测试令牌走通或得到业务层 `4xx`（非 `not_found`）。
- [ ] owner 发起移交与确认链路在测试租户上可走完或得到明确的业务错误码（非 `not_found`）。

完成项可在 PR 或变更单中备注日期与执行人。
