'use client';

import { useEffect, useState } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

type Theme = 'system' | 'light' | 'dark';
const KEY = 'afriroute:theme';

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* storage unavailable: stay on system */ }
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    apply(t);
    try {
      if (t === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch { /* ignore */ }
  };

  const options: Array<{ id: Theme; label: string; Icon: typeof SunIcon }> = [
    { id: 'light', label: 'Light', Icon: SunIcon },
    { id: 'dark', label: 'Dark', Icon: MoonIcon },
    { id: 'system', label: 'System', Icon: MonitorIcon },
  ];

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {options.map(({ id, label, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={theme === id} title={`${label} theme`} className={theme === id ? 'active' : ''} onClick={() => choose(id)}>
          <Icon width={16} height={16} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
