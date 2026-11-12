import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobAnswer, webUrl } from '../src/state/jobanswer.js'
import { FLAT } from '../src/ui/i18n.js'

const head = '# Cron Job: Demo\n\n**Job ID:** abc\n**Run Time:** 2026-11-11 08:00:00\n**Schedule:** every day\n\n'

test('jobAnswer: agent file returns what follows the LAST ## Response', () => {
  const f = head + '## Prompt\n\nWrite as:\n## Response\nshort\n\n## Script Output\nx\n\n**Response Characters:** 9\n## Response\n\nThe **answer**.\n'
  assert.equal(jobAnswer(f), 'The **answer**.')
})

test('jobAnswer: script output keeps everything after the header', () => {
  assert.equal(jobAnswer('# Cron Job: S\n\n**Job ID:** a\n**Run Time:** t\n**Mode:** no_agent (script)\n\n---\n\nline 1\n\n### Response not a heading\n'), 'line 1\n\n### Response not a heading')
})

test('jobAnswer: silent run is empty, a cut agent file shows no prompt', () => {
  assert.equal(jobAnswer('# Cron Job: S\n\n**Job ID:** a\n**Run Time:** t\n**Mode:** no_agent (script)\n**Status:** silent (empty output)\n'), '')
  assert.equal(jobAnswer(head + '## Prompt\n\n' + 'p'.repeat(50), true), '')
  assert.equal(jobAnswer(undefined), '')
})

test('jobAnswer: failed runs stay visible', () => {
  assert.equal(jobAnswer('# Cron Job: abc (FAILED)\n\nTimeout after 600s\n'), 'Timeout after 600s')
  assert.equal(jobAnswer(head + '## Prompt\n\nsecret prompt\n\n## Error\n\n```\nboom\n```\n'), '## Error\n\n```\nboom\n```')
})

test('jr.silent exists in both languages', () => { for (const l of ['en', 'ar']) assert.ok(FLAT[l]['jr.silent']) })

test('jobAnswer: a `Errors found` heading or a bare `## Error` line in script output stays whole', () => {
  assert.equal(jobAnswer(head + 'Report\n\n3 ok\n\n### Errors found\n\nnone\n'), 'Report\n\n3 ok\n\n### Errors found\n\nnone')
  assert.equal(jobAnswer(head + 'Report\n\n## Error\n\nnone\n'), 'Report\n\n## Error\n\nnone')
})

test('webUrl: only plain http(s) links without credentials', () => {
  assert.equal(webUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(webUrl('http://x.y'), 'http://x.y/')
  for (const h of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'mailto:a@b.c', 'https://user:pw@example.com', '/relative', '', undefined]) assert.equal(webUrl(h), null, String(h))
})
