import { useSession } from './useSession.js';
import { JoinScreen } from './JoinScreen.js';
import { ChatPane } from './ChatPane.js';
import { AlignmentSidebar } from './AlignmentSidebar.js';
import { PresenceList } from './PresenceList.js';

export function App() {
  const { state, participantId, join, sendMessage } = useSession();

  if (!state) {
    return <JoinScreen onJoin={join} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <PresenceList presence={state.presence} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1 }}>
          <ChatPane events={state.events} participantId={participantId} onSend={sendMessage} />
        </div>
        <AlignmentSidebar objectiveModel={state.objectiveModel} dimensionStatus={state.dimensionStatus} presence={state.presence} />
      </div>
    </div>
  );
}
