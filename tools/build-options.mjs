// The one esbuild config: tools/build.mjs writes it, tests/static.test.mjs rebuilds in memory and compares with the committed bundle.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ALLOWED = ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime']
export const out = path.join(root, 'plugin/desktop/plugin.js')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

export const options = {
  entryPoints: [path.join(root, 'src/ui/index.jsx')],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ALLOWED, // esbuild fails the build on any other import, so the bundle cannot import more than these
  legalComments: 'none',
  minify: true,
  banner: { js: `// Ultimate Dashboard ${pkg.version} — built from src/ by tools/build.mjs. Do not edit.` },
  logLevel: 'warning'
}
