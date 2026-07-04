import type { SessionState } from './useSession.js';

export function PresenceList({ presence }: { presence: SessionState['presence'] }) {
  const entries = Object.entries(presence.participants);
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #ddd', fontSize: 13 }}>
      {entries.map(([id, p]) => (
        <span key={id} style={{ marginRight: 12, opacity: p.connected ? 1 : 0.4 }}>
          {p.displayName}
        </span>
      ))}
    </div>
  );
}
