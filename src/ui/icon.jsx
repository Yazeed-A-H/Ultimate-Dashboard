// Icons: Hermes codicons; the direction-sensitive ones mirror in RTL.
import { Codicon, cn } from '@hermes/plugin-sdk'

const FLIP = new Set(['chevron-right', 'chevron-left', 'arrow-right', 'arrow-left', 'send', 'link-external', 'discard', 'redo'])

export function Icon({ name, className }) {
  return <Codicon name={name} className={cn(FLIP.has(name) && 'ht-flip', className)} />
}
