import { useState } from 'react';
import type { ChatEvent, SessionState } from './useSession.js';

function messageText(event: ChatEvent): string | null {
  if (event.type === 'MessagePosted') return (event.payload as { text: string }).text;
  if (event.type === 'AgentMessagePosted') return (event.payload as { text: string }).text;
  return null;
}

function speakerLabel(event: ChatEvent, participants: SessionState['presence']['participants']): string {
  if (event.actor.kind === 'agent') return 'Agent';
  const id = event.actor.participantId;
  if (!id) return 'unknown';
  return participants[id]?.displayName ?? id;
}

export function ChatPane({
  events,
  presence,
  onSend,
}: {
  events: ChatEvent[];
  participantId: string | null;
  presence: SessionState['presence'];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const messages = events.filter((e) => messageText(e) !== null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.map((event) => (
          <div
            key={event.seq}
            style={{
              marginBottom: 8,
              padding: 8,
              borderRadius: 6,
              background: event.actor.kind === 'agent' ? '#eef2ff' : '#f4f4f5',
            }}
          >
            <strong>{speakerLabel(event, presence.participants)}: </strong>
            {messageText(event)}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onSend(draft);
          setDraft('');
        }}
        style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ddd' }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} placeholder="Say something..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
