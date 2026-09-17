import type { Metadata } from 'next'
import { getOAuthIssuer } from '@/lib/oauth2/issuer'
import { OAuth2DocsToc } from './oauth2-toc'

export const metadata: Metadata = {
  title: 'OAuth2 / OIDC 客户端接入指南',
  description:
    '企业级授权服务器对接说明：约定与术语、Discovery、控制台注册、授权码与 PKCE、令牌与刷新、UserInfo、吊销与自省、登出、错误码与排障。',
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md border border-border/60 bg-muted/70 px-1.5 py-px font-mono text-[0.8125rem] font-medium text-foreground">
      {children}
    </code>
  )
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-28 border-b border-border/55 pb-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl sm:leading-snug"
    >
      {children}
    </h2>
  )
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-24 pt-1 text-base font-semibold tracking-tight text-foreground sm:text-lg">
      {children}
    </h3>
  )
}

export default async function OAuth2DocsPage() {
  let issuer: string
  try {
    issuer = getOAuthIssuer()
  } catch {
    issuer = 'https://<部署域名>'
  }
  const algs = 'RS256（需配置 RSA 私钥）'

  return (
    <div className="docs-doc-shell">
      <div className="docs-doc-grid">
        <aside className="hidden min-w-0 border-border/50 lg:block lg:border-r lg:pr-8">
          <div className="sticky top-[5.25rem] max-h-[min(32rem,calc(100dvh-6rem))] overflow-y-auto overscroll-contain pb-8 [-webkit-overflow-scrolling:touch]">
            <p className="docs-toc-heading">本页内容</p>
            <OAuth2DocsToc />
          </div>
        </aside>

        <article className="min-w-0 lg:pl-2 xl:pl-4">
          <details className="group mb-8 overflow-hidden rounded-xl border border-border/60 bg-card/90 shadow-sm lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
              <span>本页目录</span>
              <span className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
                ▼
              </span>
            </summary>
            <div className="border-t border-border/55 px-4 py-4">
              <OAuth2DocsToc />
            </div>
          </details>

          <header className="mb-10 space-y-5 border-b border-border/45 pb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Integration · Public</p>
            <h1 className="text-[1.75rem] font-bold tracking-tight text-foreground sm:text-[2rem] sm:leading-snug lg:text-[2.25rem]">
              OAuth2 / OIDC 客户端接入指南
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              本系统在企业场景下同时承担 <strong className="text-foreground">授权服务器（Authorization Server / OpenID Provider）</strong>
              角色；贵司或生态伙伴的业务应用作为 <strong className="text-foreground">OAuth 2.0 客户端（Relying Party）</strong>
              ，通过标准协议完成用户身份委托与令牌交换。本文按<strong className="text-foreground">章—节</strong>
              组织，便于评审、联调与归档。
            </p>
            <p className="text-base leading-relaxed text-muted-foreground">
              文档中的占位符 <Code>{'{ISSUER}'}</Code> 在本部署环境中解析为 <Code>{issuer}</Code>
              （优先读取环境变量 <Code>OAUTH_ISSUER_URL</Code>；未配置时回退至 <Code>NEXTAUTH_URL</Code>。issuer 字符串<strong className="text-foreground">不得包含末尾斜杠</strong>
              ，并与对外提供的 HTTPS 基线一致）。
            </p>
          </header>

          <div className="docs-prose space-y-14 sm:space-y-16">
        {/* 第 1 章 */}
        <section className="space-y-4">
          <H2 id="conventions">1. 约定、术语与边界</H2>

          <H3 id="conventions-terms">1.1 术语与引用规范</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">{'{ISSUER}'}</strong>：授权服务器的 HTTPS 根，无尾斜杠；所有端点 URL 均由 Discovery 或本文占位符推导。
            </li>
            <li>
              <strong className="text-foreground">RP / 客户端</strong>：消费令牌的贵方应用；<strong className="text-foreground">用户代理</strong>
              ：通常为用户浏览器。
            </li>
            <li>
              涉及 OAuth 2.0 与 OIDC 行为时，本文默认对齐 <strong className="text-foreground">RFC 6749</strong>（授权框架）、
              <strong className="text-foreground">RFC 7636</strong>（PKCE）、<strong className="text-foreground">RFC 7009</strong>（吊销）、
              <strong className="text-foreground">RFC 7662</strong>（自省）及 <strong className="text-foreground">OpenID Connect Core</strong> 的常见子集。
            </li>
            <li>
              与具体字段、算法、端点列表冲突时，以线上 <Code>GET {'{ISSUER}'}/.well-known/openid-configuration</Code> 的<strong className="text-foreground">实际 JSON</strong>为准。
            </li>
          </ul>

          <H3 id="conventions-boundary">1.2 与本系统其它能力的关系</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">控制台登录</strong>（邮箱密码、Passkey、MFA）用于<strong className="text-foreground">管理员访问本系统 UI</strong>
              ；与「本系统作为 IdP 向第三方应用签发 OAuth 令牌」在协议上<strong className="text-foreground">独立</strong>，但共享同一用户目录与租户上下文。
            </li>
            <li>
              用户经 <Code>/oauth/authorize</Code> 完成身份校验时，若未登录会先进入本系统 <Code>/login</Code>；若账号启用了 MFA 且会话处于待验证状态，会经 <Code>/mfa</Code> 完成第二步后再回到授权 URL（见下文）。
            </li>
          </ul>
        </section>

        {/* 第 2 章 */}
        <section className="space-y-4">
          <H2 id="discovery">2. 元数据与端点发现</H2>

          <H3 id="discovery-why">2.1 为何以 Discovery 为第一步</H3>
          <p>
            将「拉取 OIDC Provider 元数据」作为集成工作的<strong className="text-foreground">第一步</strong>
            ，可在 issuer 调整、路径变更或多环境部署时<strong className="text-foreground">减少硬编码</strong>。客户端应缓存元数据（建议短 TTL + 失效再拉取），并在发布前用预生产环境验证解析逻辑。
          </p>

          <H3 id="discovery-requests">2.2 请求与缓存建议</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">Discovery</strong>：<Code>GET {'{ISSUER}'}/.well-known/openid-configuration</Code>，响应为 JSON；本实现附带{' '}
              <Code>Cache-Control: public, max-age=300</Code>，仍建议在客户端侧控制刷新策略。
            </li>
            <li>
              <strong className="text-foreground">JWKS</strong>：当部署配置了 RSA 等非对称密钥时，元数据中会包含 <Code>jwks_uri</Code>（一般为{' '}
              <Code>{'{ISSUER}'}/.well-known/jwks.json</Code>）。依赖方校验 <Code>id_token</Code> 或自建 JWT 验签时应拉取 JWKS；OIDC 必须配置有效 RSA 私钥；缺失或无效时 Discovery 返回 503，ID Token 不降级为 HS256。签名算法见{' '}
              <Code>id_token_signing_alg_values_supported</Code> 为准。
            </li>
          </ul>

          <H3 id="discovery-fields">2.3 元数据字段说明（摘要）</H3>
          <p>当前实现中典型字段包括（完整列表以线上响应为准）：</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>issuer</Code>、<Code>authorization_endpoint</Code>、<Code>token_endpoint</Code>、<Code>userinfo_endpoint</Code>、
              <Code>end_session_endpoint</Code>、<Code>revocation_endpoint</Code>、<Code>introspection_endpoint</Code>
            </li>
            <li>
              <Code>response_types_supported</Code>：当前为 <Code>code</Code>（授权码模式）
            </li>
            <li>
              <Code>grant_types_supported</Code>：<Code>authorization_code</Code>、<Code>refresh_token</Code>
            </li>
            <li>
              <Code>scopes_supported</Code>：<Code>openid</Code>、<Code>profile</Code>、<Code>email</Code>、<Code>offline_access</Code>
            </li>
            <li>
              <Code>token_endpoint_auth_methods_supported</Code>：<Code>client_secret_post</Code>、<Code>client_secret_basic</Code>
            </li>
            <li>
              <Code>id_token_signing_alg_values_supported</Code>：当前部署为 <Code>{algs}</Code>
            </li>
          </ul>
        </section>

        {/* 第 3 章 */}
        <section className="space-y-4">
          <H2 id="register">3. 在管理控制台注册客户端</H2>

          <H3 id="register-console">3.1 入口、权限与数据模型</H3>
          <p>
            请由具备相应<strong className="text-foreground">后台管理权限</strong>的账号登录控制台，在侧栏进入 <strong className="text-foreground">「应用管理」</strong>
            （<Code>/applications</Code>）：先创建或选择业务应用，再在列表中进入 <strong className="text-foreground">「配置 OIDC / 管理 OIDC」</strong>（路径形如{' '}
            <Code>/applications/&lt;应用 id&gt;/idp</Code>）。IdP 客户端与 RBAC 应用在数据上<strong className="text-foreground">合一</strong>
            ：同意页展示名称、Logo 等与该应用记录一致。
          </p>

          <H3 id="register-fields">3.2 回调、Scope、令牌与客户端类型</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">登录回调 URI（redirect_uri 白名单）</strong>：与授权请求中的 <Code>redirect_uri</Code> 必须
              <strong className="text-foreground">逐字节一致</strong>（协议、主机、端口、路径、末尾斜杠均敏感）；支持登记多条。
            </li>
            <li>
              <strong className="text-foreground">登出后回调</strong>：用于 <Code>post_logout_redirect_uri</Code> 白名单；须与 OIDC 登出请求中的参数一致（见第 7 章）。
            </li>
            <li>
              <strong className="text-foreground">机密（Confidential）客户端</strong>：换 token 与自省等操作须提供 <Code>client_secret</Code>（表单字段或 HTTP Basic）；密钥仅在创建/轮换时<strong className="text-foreground">一次性展示</strong>，请离线安全保存。
            </li>
            <li>
              <strong className="text-foreground">公开（Public）客户端</strong>：授权端点<strong className="text-foreground">强制 PKCE</strong>（<Code>code_challenge</Code> +{' '}
              <Code>code_challenge_method=S256</Code>）；换 token 时必须提交 <Code>code_verifier</Code>。
            </li>
            <li>
              <strong className="text-foreground">Scope</strong>：在控制台勾选允许的 scope；若需 <Code>refresh_token</Code>，须同时勾选允许 refresh 授权，并在授权请求中包含 <Code>offline_access</Code>（且该 scope 在白名单内）。
            </li>
            <li>
              <strong className="text-foreground">令牌生命周期</strong>：访问令牌 TTL、刷新令牌天数、授权码有效期等可在客户端维度配置（实现中带上下限钳制）。
            </li>
          </ul>

          <H3 id="register-seed">3.3 开发环境种子客户端</H3>
          <p>
            开发环境可通过 <Code>pnpm run seed</Code> 预置示例机密客户端（若尚不存在）：<Code>rbac_demo_client</Code> /{' '}
            <Code>demo_secret_please_change</Code>。该凭据<strong className="text-foreground">仅限本地与联调</strong>
            ，禁止写入生产配置仓库或面向最终用户的渠道；生产环境请单独创建客户端并纳入贵司密钥管理流程。
          </p>
        </section>

        {/* 第 4 章 */}
        <section className="space-y-4">
          <H2 id="flow">4. 授权码 + PKCE 全流程</H2>

          <H3 id="flow-roles">4.1 浏览器端与后端职责划分</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-foreground">浏览器</strong>：保存 <Code>state</Code>、<Code>nonce</Code>（若使用）、<Code>code_verifier</Code>（PKCE）；引导用户打开授权 URL；接收带 <Code>code</Code> 的重定向。
            </li>
            <li>
              <strong className="text-foreground">贵方后端</strong>：用 <Code>code</Code> 调用 <Code>POST /oauth/token</Code>（携带 <Code>client_secret</Code> 等机密）；校验 <Code>state</Code>；校验/存储新 <Code>refresh_token</Code>（若启用轮换）。
            </li>
          </ul>

          <H3 id="flow-authorize">4.2 授权请求与错误表现</H3>
          <p>
            将用户浏览器重定向至 <Code>GET {'{ISSUER}'}/oauth/authorize</Code>，查询参数至少包括：
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>response_type=code</Code>（本实现仅支持授权码；其它类型将返回错误）
            </li>
            <li>
              <Code>client_id</Code>、<Code>redirect_uri</Code>、<Code>scope</Code>（默认若省略则按实现可能回落为 <Code>openid</Code>，仍以控制台白名单为准）
            </li>
            <li>
              <Code>state</Code>：<strong className="text-foreground">强烈必填</strong>，用于防 CSRF 与串联授权会话
            </li>
            <li>
              公开客户端：<Code>code_challenge</Code> 与 <Code>code_challenge_method=S256</Code>（若提供非 S256 的 challenge 方法，将重定向回 <Code>redirect_uri</Code> 并带 <Code>error</Code>）
            </li>
            <li>
              OIDC 建议：<Code>nonce</Code>，供后续校验 <Code>id_token</Code>
            </li>
          </ul>
          <p>
            <strong className="text-foreground">错误时的两种表现</strong>（实现相关，联调时请注意区分）：
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              部分错误（如 <Code>invalid_scope</Code>、<Code>unauthorized_client</Code>）会对 <Code>redirect_uri</Code> 执行<strong className="text-foreground">302 重定向</strong>
              ，在查询串中附带 <Code>error</Code>、<Code>error_description</Code>，并尽量保留 <Code>state</Code>。
            </li>
            <li>
              部分错误（如缺少 <Code>client_id</Code>、<Code>redirect_uri</Code> 未在白名单、<Code>invalid_client</Code>）可能返回 <strong className="text-foreground">JSON 4xx</strong>
              ，不会重定向到贵方回调地址——贵方前端应对非 3xx 响应做兜底提示。
            </li>
          </ul>

          <H3 id="flow-login-mfa">4.3 登录页与 MFA 插页</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              若用户尚未建立控制台会话，授权端点会 <strong className="text-foreground">302</strong> 至 <Code>/login?callbackUrl=…</Code>，其中 <Code>callbackUrl</Code> 为完整的 <Code>/oauth/authorize?…</Code> 原始查询，登录成功后浏览器应回到该 URL 继续授权。
            </li>
            <li>
              若会话存在但处于 <strong className="text-foreground">MFA 待完成</strong>状态，将 <strong className="text-foreground">302</strong> 至 <Code>/mfa?callbackUrl=…</Code>，完成第二步验证后再回到授权 URL。
            </li>
          </ul>

          <H3 id="flow-consent-callback">4.4 同意页与回调校验</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              已登录且通过 MFA 后，用户进入 <strong className="text-foreground">授权同意页</strong> <Code>/oauth/consent</Code>（查询串与授权请求一致）；同意后，用户浏览器携带 <Code>code</Code> 重定向至登记的 <Code>redirect_uri</Code>。
            </li>
            <li>
              贵方回调处理中应校验：<Code>state</Code> 与发起授权时一致；<Code>code</Code> 仅使用一次；随后在后端用 <Code>code</Code> 换 token，勿在纯前端暴露 <Code>client_secret</Code>。
            </li>
          </ul>
        </section>

        {/* 第 5 章 */}
        <section className="space-y-4">
          <H2 id="token">5. 令牌端点（<Code>POST {'{ISSUER}'}/oauth/token</Code>）</H2>

          <H3 id="token-transport">5.1 传输格式与客户端认证</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>Content-Type</Code> 必须为 <Code>application/x-www-form-urlencoded</Code>（请求体为 URL 编码键值对）。
            </li>
            <li>
              <strong className="text-foreground">client_secret_post</strong>：<Code>client_id</Code>、<Code>client_secret</Code> 与其它参数一并放在表单中。
            </li>
            <li>
              <strong className="text-foreground">client_secret_basic</strong>：使用 <Code>Authorization: Basic Base64(client_id:client_secret)</Code>，client_id 与 secret 应先分别按表单规则编码。表单可省略 client_id；若提供必须一致，不能同时发送 client_secret。
            </li>
          </ul>

          <H3 id="token-code">5.2 授权码换 token（<Code>grant_type=authorization_code</Code>）</H3>
          <p className="font-medium text-foreground">常用表单字段</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>grant_type=authorization_code</Code>
            </li>
            <li>
              <Code>code</Code>：授权回调得到的授权码（一次性）
            </li>
            <li>
              <Code>redirect_uri</Code>：必须与授权步骤中使用的值<strong className="text-foreground">完全一致</strong>
            </li>
            <li>
              <Code>client_id</Code>：必填
            </li>
            <li>
              机密客户端：<Code>client_secret</Code>（或 Basic），否则返回 <Code>401 invalid_client</Code>
            </li>
            <li>
              公开客户端：<Code>code_verifier</Code> 必填，且须与授权时的 <Code>code_challenge</Code> 通过 S256 校验一致
            </li>
            <li>
              若授权时绑定了 PKCE（含机密客户端可选 PKCE），换 token 时同样须提交正确的 <Code>code_verifier</Code>
            </li>
          </ul>
          <p className="font-medium text-foreground">成功时 JSON 响应（节选）</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>access_token</Code>、<Code>token_type</Code>（Bearer）、<Code>expires_in</Code>（秒）、<Code>scope</Code>
            </li>
            <li>
              若 scope 含 <Code>openid</Code>：<Code>id_token</Code>（JWT）
            </li>
            <li>
              若 scope 含 <Code>offline_access</Code> 且客户端允许 refresh：<Code>refresh_token</Code>
            </li>
            <li>
              响应头含 <Code>Cache-Control: no-store</Code>、<Code>Pragma: no-cache</Code>
            </li>
          </ul>

          <H3 id="token-refresh">5.3 刷新令牌与轮换（<Code>grant_type=refresh_token</Code>）</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              表单字段：<Code>grant_type=refresh_token</Code>、<Code>refresh_token</Code>、<Code>client_id</Code>；机密客户端须带 <Code>client_secret</Code> 或 Basic。
            </li>
            <li>
              本实现采用<strong className="text-foreground">刷新令牌轮换</strong>：每次成功刷新会签发<strong className="text-foreground">新的</strong> <Code>refresh_token</Code>，旧值立即失效；贵方须<strong className="text-foreground">原子更新</strong>持久化中的 refresh token，并串行刷新；重复使用旧 token 会吊销它的后续刷新令牌，需要重新登录。轮换保留初始绝对过期时间；可用 scope 参数缩减权限。
            </li>
            <li>
              若客户端或所属应用租户被归档等，换发可能失败（实现中可能返回 <Code>invalid_grant</Code> 及中文描述，请以实际响应为准）。
            </li>
          </ul>

          <H3 id="token-errors">5.4 错误码与响应体（令牌端点）</H3>
          <p>令牌端点错误以 JSON 返回，典型结构为：</p>
          <pre className="docs-pre" tabIndex={0}>
            {'{'} &quot;error&quot;: &quot;invalid_grant&quot;, &quot;error_description&quot;: &quot;…&quot; {'}'}
          </pre>
          <p className="mt-2">常见 <Code>error</Code> 取值包括：</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <Code>invalid_request</Code>：缺少必填参数或无法解析请求体（HTTP 400）
            </li>
            <li>
              <Code>invalid_client</Code>：未知 <Code>client_id</Code> 或 <Code>client_secret</Code> 错误（HTTP 400/401，视分支）
            </li>
            <li>
              <Code>invalid_grant</Code>：授权码无效/已使用、<Code>redirect_uri</Code> 不一致、PKCE 校验失败、refresh 无效或已吊销、用户不可用、租户归档等（HTTP 400）
            </li>
            <li>
              <Code>unauthorized_client</Code>：该客户端未启用对应 grant（HTTP 400）
            </li>
            <li>
              <Code>unsupported_grant_type</Code>：非 <Code>authorization_code</Code> / <Code>refresh_token</Code>（HTTP 400）
            </li>
          </ul>
        </section>

        {/* 第 6 章 */}
        <section className="space-y-4">
          <H2 id="resource">6. UserInfo、吊销、自省与登出</H2>

          <H3 id="resource-userinfo">6.1 UserInfo（<Code>GET {'{ISSUER}'}/oauth/userinfo</Code>）</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              请求头：<Code>Authorization: Bearer {'{access_token}'}</Code>
            </li>
            <li>
              响应为 JSON，至少包含 <Code>sub</Code>；在 access token 的 scope 包含 <Code>email</Code> / <Code>profile</Code> 时返回对应声明（如 <Code>email</Code>、<Code>name</Code>、<Code>picture</Code>）。
            </li>
            <li>
              令牌无效或校验失败时返回 <Code>401</Code>，JSON 形如 <Code>{'{"error":"invalid_token"}'}</Code>。
            </li>
          </ul>

          <H3 id="resource-revoke">6.2 令牌吊销（<Code>POST {'{ISSUER}'}/oauth/revoke</Code>，RFC 7009）</H3>
          <p>
            表单提交 <Code>token</Code> 和客户端身份；机密客户端必须认证，公开客户端提供 client_id。仅吊销该客户端的 refresh_token 及其轮换后续令牌。显式请求吊销 access_token 返回 unsupported_token_type；JWT access_token 在到期前仍可用。
          </p>

          <H3 id="resource-introspect">6.3 令牌自省（<Code>POST {'{ISSUER}'}/oauth/introspect</Code>，RFC 7662）</H3>
          <p>
            需机密客户端凭据；表单字段包含 <Code>token</Code>。用于资源服务器在无法本地验 JWT 时向授权服务器查询令牌活跃状态与元数据（具体返回字段以实现为准）。
          </p>

          <H3 id="resource-logout">6.4 RP 发起登出（<Code>GET {'{ISSUER}'}/oauth/logout</Code>）</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              查询参数包括 client_id 或已签名的 id_token_hint、可选 post_logout_redirect_uri 和 state。经 Auth.js 确认登出后返回登记地址；不指定回调也会登出并返回登录页。登出不等同于吊销已签发令牌。
            </li>
            <li>
              <Code>post_logout_redirect_uri</Code> 必须在控制台「登出后回调」白名单中<strong className="text-foreground">逐项匹配</strong>；生产环境请使用 HTTPS 并采用最小化白名单。
            </li>
          </ul>
        </section>

        {/* 第 7 章 */}
        <section className="space-y-4">
          <H2 id="security">7. 安全清单、核对表与排障</H2>

          <H3 id="security-checklist">7.1 实施核对表（上线前建议逐项勾选）</H3>
          <ul className="list-disc space-y-2 pl-5">
            <li>授权与回调全程 HTTPS；证书域名与 issuer、回调域策略一致。</li>
            <li>
              强制校验 <Code>state</Code>；OIDC 场景校验 <Code>nonce</Code> 与 <Code>id_token</Code>（签名、aud、iss、exp）。
            </li>
            <li>
              <Code>client_secret</Code> 仅存在于贵方服务端；移动应用使用公开客户端模型时必须 PKCE。
            </li>
            <li>正确处理 refresh 轮换后的持久化与并发。</li>
            <li>为 Discovery/JWKS 拉取失败、令牌端点 4xx 设计重试与告警，不向最终用户暴露原始 error_description。</li>
          </ul>

          <H3 id="security-faq">7.2 常见问题（FAQ）</H3>
          <dl className="space-y-4">
            <div>
              <dt className="font-medium text-foreground">换 token 报 invalid_grant「redirect_uri 与授权时不一致」？</dt>
              <dd className="mt-1 pl-0">
                请比对授权请求与 token 请求中的 <Code>redirect_uri</Code> 是否完全一致（含尾斜杠与 URL 编码差异）。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">公开客户端报必须 PKCE？</dt>
              <dd className="mt-1">
                本实现对公开客户端在 <Code>/oauth/authorize</Code> 强制 <Code>code_challenge</Code> + <Code>S256</Code>；换 token 时必须提交匹配的 <Code>code_verifier</Code>。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">没有返回 refresh_token？</dt>
              <dd className="mt-1">
                需授权请求 scope 含 <Code>offline_access</Code>，且控制台为该客户端启用 refresh 授权；否则仅返回 access（及可选 id）令牌。
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">希望使用 RS256 与 JWKS？</dt>
              <dd className="mt-1">
                在部署环境配置 <Code>OAUTH_RSA_PRIVATE_KEY_B64</Code>（或等价 PEM）；未配置时可能回退为对称算法（参见 Discovery 中 <Code>id_token_signing_alg_values_supported</Code>）。
              </dd>
            </div>
          </dl>

          <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">免责声明与变更说明</p>
            <p className="mt-2">
              本文档描述本仓库当前版本的典型集成路径；若贵司二次开发调整了路由、端点语义或安全策略，请以<strong className="text-foreground">线上 Discovery 响应与正式发布说明</strong>
              为准。建议在预生产环境使用独立测试客户端完成回归后再变更生产。
            </p>
          </div>
        </section>
          </div>
        </article>
      </div>
    </div>
  )
}
