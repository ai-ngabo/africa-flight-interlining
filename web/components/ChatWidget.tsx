'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ChatIcon, ChevronUpIcon, CloseIcon, MinusIcon, SendIcon, TrashIcon } from './icons';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: string;
  sources?: string[];
  error?: boolean;
  at: number;
}

type View = 'closed' | 'open' | 'minimized';

const KEY = 'afriroute:chat:v1';
const SUGGESTIONS = [
  'Do I need a visa to self-transfer in Nairobi?',
  'Can a Nigerian take the coach from Lagos to Accra visa-free?',
  'What is the baggage allowance on Air Peace?',
  'What does self-transfer protection cover?',
];

const uid = () => Math.random().toString(36).slice(2, 10);
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatWidget({ nationality }: { nationality: string }) {
  const [view, setView] = useState<View>('closed');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [unread, setUnread] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef<View>(view);
  viewRef.current = view;

  // Restore conversation history (per browser) on first load.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setMsgs(JSON.parse(raw) as Msg[]);
    } catch { /* ignore corrupt or blocked storage */ }
  }, []);

  useEffect(() => {
    try {
      if (msgs.length) localStorage.setItem(KEY, JSON.stringify(msgs.slice(-50)));
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, [msgs]);

  useEffect(() => {
    if (view !== 'open') return;
    setUnread(0);
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view, msgs, busy]);

  useEffect(() => {
    if (view === 'open') inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewRef.current === 'open') setView('minimized');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const send = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (question.length < 3 || busy) return;
    setInput('');
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: question, at: Date.now() }]);
    setBusy(true);
    try {
      const r = await api<{ answer: string; mode: string; sources?: string[] }>('/api/assist/ask', {
        method: 'POST',
        body: JSON.stringify({ question, nationality }),
      });
      setMsgs((m) => [...m, { id: uid(), role: 'assistant', text: r.answer || 'No answer returned.', mode: r.mode, sources: r.sources, at: Date.now() }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: uid(), role: 'assistant', text: `Sorry, I couldn't reach the assistant: ${(e as Error).message}`, error: true, at: Date.now() }]);
    } finally {
      setBusy(false);
      if (viewRef.current !== 'open') setUnread((u) => u + 1);
    }
  }, [busy, nationality]);

  const clear = () => {
    if (!confirmClear) return setConfirmClear(true);
    setMsgs([]);
    setConfirmClear(false);
    inputRef.current?.focus();
  };

  if (view === 'closed') {
    return (
      <button type="button" className="chat-launcher" onClick={() => setView('open')} aria-label="Open travel assistant">
        <ChatIcon width={22} height={22} />
        <span className="chat-launcher-label">Ask AfriRoute</span>
        {unread > 0 && <span className="chat-badge" aria-label={`${unread} new`}>{unread}</span>}
      </button>
    );
  }

  const minimized = view === 'minimized';
  return (
    <section className={`chat-panel ${minimized ? 'is-min' : ''}`} role="dialog" aria-label="Travel assistant" aria-modal="false">
      <header className="chat-head" onClick={minimized ? () => setView('open') : undefined}>
        <div className="chat-title">
          <span className="chat-avatar"><ChatIcon width={18} height={18} /></span>
          <div>
            <strong>Travel assistant</strong>
            <small>{busy ? 'Typing…' : 'Visas · baggage · protection'}</small>
          </div>
          {minimized && unread > 0 && <span className="chat-badge inline">{unread}</span>}
        </div>
        <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={`icon-btn ${confirmClear ? 'danger' : ''}`} onClick={clear} disabled={!msgs.length} title="Clear history" aria-label={confirmClear ? 'Confirm clear history' : 'Clear history'}>
            {confirmClear ? <span className="confirm-text">Clear?</span> : <TrashIcon width={16} height={16} />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setView(minimized ? 'open' : 'minimized')} title={minimized ? 'Expand' : 'Minimize'} aria-label={minimized ? 'Expand assistant' : 'Minimize assistant'}>
            {minimized ? <ChevronUpIcon width={16} height={16} /> : <MinusIcon width={16} height={16} />}
          </button>
          <button type="button" className="icon-btn" onClick={() => setView('closed')} title="Close" aria-label="Close assistant">
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      </header>

      {!minimized && (
        <>
          <div className="chat-body" ref={bodyRef} aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-welcome">
                <p><strong>Hi! I can help with entry rules, free-movement protocols (ECOWAS, EAC), baggage and self-transfer protection.</strong></p>
                <p className="muted small">Answers use your selected passport ({nationality}). Try:</p>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`bubble-row ${m.role}`}>
                <div className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
                  <p>{m.text}</p>
                  <span className="bubble-meta">
                    {time(m.at)}
                    {m.mode && ` · ${m.mode === 'llm' ? 'AI' : 'rules engine'}`}
                    {m.sources?.length ? ` · ${m.sources.join(', ')}` : ''}
                  </span>
                </div>
              </div>
            ))}
            {busy && (
              <div className="bubble-row assistant">
                <div className="bubble assistant typing" aria-label="Assistant is typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask about visas, baggage…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              maxLength={1000}
              aria-label="Message"
            />
            <button type="submit" className="send-btn" disabled={busy || input.trim().length < 3} aria-label="Send">
              <SendIcon width={18} height={18} />
            </button>
          </form>
          <p className="chat-disclaimer">Sample rules for the MVP. Always verify with official immigration sources.</p>
        </>
      )}
    </section>
  );
}
