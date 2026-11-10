// Build plugin/desktop/plugin.js from src/ (esbuild config: tools/build-options.mjs).
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { options, out, root } from './build-options.mjs'

await build(options)
console.log(`built ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`)
