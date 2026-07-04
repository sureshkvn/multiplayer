import { useState } from 'react';

export function JoinScreen({ onJoin }: { onJoin: (sessionId: string, displayName: string) => void }) {
  const [sessionId, setSessionId] = useState('japan-trip-demo');
  const [displayName, setDisplayName] = useState('');

  return (
    <div style={{ maxWidth: 320, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h2>Join a session</h2>
      <label>
        Session code
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <button disabled={!displayName || !sessionId} onClick={() => onJoin(sessionId, displayName)} style={{ marginTop: 12 }}>
        Join
      </button>
    </div>
  );
}
