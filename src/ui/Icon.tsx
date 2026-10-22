// Icons: Lucide (ISC) via ./lucide where a match exists, else a few extra line glyphs on the same 24px grid.
import { ICONS } from './lucide';

const EXTRA: Record<string, string> = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  books: '<path d="M4 4h4v16H4zM10 6h4v14h-4zM15.5 7.2l3.9-.9 3 13.6-3.9.9z"/>',
  'external-link': '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'pen-line': '<path d="M12 20h9M16.4 3.6a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  'folder-open': '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.5 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"/>',
  'type-size': '<path d="M3 18 7.5 6h1L13 18M4.6 14h6.8M15 18l3-8h1l3 8M15.9 15.5h5.2"/>',
  'columns-2': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  scroll: '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M19 17V5a2 2 0 0 0-2-2H4"/>',
  'cloud-download': '<path d="M12 13v8M8 17l4 4 4-4M20.9 15.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7M17 12H7"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
};
const ALIAS: Record<string, string> = { trash: 'trash-2', close: 'x', left: 'chevron-left', right: 'chevron-right', grid: 'layout-grid', settings: 'settings-2', font: 'a-large-small' };

export function Icon({ name, size = 18, className = '', fill = false }: { name: string; size?: number; className?: string; fill?: boolean }) {
  const inner = ICONS[ALIAS[name] ?? name] ?? EXTRA[name] ?? ICONS['circle-help'];
  return (
    <svg className={'ic ' + className} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: inner }} />
  );
}
