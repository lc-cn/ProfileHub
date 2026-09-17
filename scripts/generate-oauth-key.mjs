import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

const target = resolve(process.argv[2] || '.env.local')
if (existsSync(target) && !lstatSync(target).isFile()) throw new Error('目标必须是普通文件')
const previous = existsSync(target) ? readFileSync(target, 'utf8') : ''
const env = parse(previous)
if (env.OAUTH_RSA_PRIVATE_KEY_B64?.trim() || env.OAUTH_RSA_PRIVATE_KEY_PEM?.trim()) {
  throw new Error('目标文件已有 RSA 私钥，未修改。轮换密钥需要单独安排。')
}
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const contents = `${previous}${previous.endsWith('\n') || !previous ? '' : '\n'}OAUTH_RSA_PRIVATE_KEY_B64=${Buffer.from(pem).toString('base64')}\n`
writeFileSync(target, contents, { mode: 0o600 })
chmodSync(target, 0o600)
console.log(`已生成 3072 位 RSA PKCS8 私钥并写入 ${target}（权限 600）。私钥未输出；重启 IdP 后生效。`)
