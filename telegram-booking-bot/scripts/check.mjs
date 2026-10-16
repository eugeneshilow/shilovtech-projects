// Проверка проекта: форматтер → линтер → типы → тесты, в этом порядке.
// Форматтер и линтер смотрят только файлы под git (git ls-files, без игнорируемых).
// Итог — одной строкой в .check-result (файл в .gitignore).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => file && existsSync(file))
const lintable = files.filter((file) => /\.(c|m)?(j|t)s$/.test(file))

const steps = [
  ['форматтер', 'prettier', ['--check', '--ignore-unknown', ...files]],
  ['линтер', 'eslint', ['--max-warnings=0', '--no-warn-ignored', ...lintable]],
  ['типы', 'tsc', ['--noEmit', '-p', '.']],
  ['типы convex', 'tsc', ['--noEmit', '-p', 'convex']],
  ['тесты', 'vitest', ['run']],
]

const started = Date.now()
let failed = null
for (const [name, bin, args] of steps) {
  console.log(`\n▶ ${name}`)
  const result = spawnSync(`node_modules/.bin/${bin}`, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    failed = name
    break
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
const at = new Date().toISOString()
const line = failed ? `red · ${failed} · ${at} · ${seconds}s` : `green · ${at} · ${seconds}s`
writeFileSync('.check-result', `${line}\n`)
console.log(`\n${failed ? '✖' : '✔'} check ${line}`)
process.exit(failed ? 1 : 0)
