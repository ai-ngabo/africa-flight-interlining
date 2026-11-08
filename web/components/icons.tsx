import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P): P => ({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...p });

export const SunIcon = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const MoonIcon = (p: P) => <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
export const MonitorIcon = (p: P) => <svg {...base(p)}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
export const ChatIcon = (p: P) => <svg {...base(p)}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" /></svg>;
export const TrashIcon = (p: P) => <svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>;
export const MinusIcon = (p: P) => <svg {...base(p)}><path d="M5 12h14" /></svg>;
export const ChevronUpIcon = (p: P) => <svg {...base(p)}><path d="M6 15l6-6 6 6" /></svg>;
export const CloseIcon = (p: P) => <svg {...base(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>;
export const SendIcon = (p: P) => <svg {...base(p)}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
export const SwapIcon = (p: P) => <svg {...base(p)}><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>;
export const PlaneIcon = (p: P) => <svg {...base(p)}><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></svg>;
export const BusIcon = (p: P) => <svg {...base(p)}><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M4 11h16M8 21v-4M16 21v-4M8 14h.01M16 14h.01" /></svg>;
export const ShieldIcon = (p: P) => <svg {...base(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
