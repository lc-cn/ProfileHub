import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const path = resolve(root, 'src', specifier.slice(2))
      for (const suffix of ['.ts', '.tsx', '/index.ts']) {
        if (existsSync(path + suffix)) return nextResolve(pathToFileURL(path + suffix).href, context)
      }
    }
    if (['next/server', 'next/headers', 'next/navigation'].includes(specifier)) {
      return nextResolve(specifier + '.js', context)
    }
    return nextResolve(specifier, context)
  },
})
