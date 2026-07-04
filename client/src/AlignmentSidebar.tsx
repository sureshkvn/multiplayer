import type { SessionState } from './useSession.js';

const DIMENSION_LABELS: Record<string, string> = {
  dates: 'Travel dates',
  budget: 'Per-person budget',
  places: 'Top 3 places',
  airline: 'Airline',
};

function badgeColor(status: string): string {
  if (status === 'aligned') return '#16a34a';
  if (status === 'conflict') return '#dc2626';
  return '#6b7280';
}

export function AlignmentSidebar({ objectiveModel, dimensionStatus, presence }: {
  objectiveModel: SessionState['objectiveModel'];
  dimensionStatus: SessionState['dimensionStatus'];
  presence: SessionState['presence'];
}) {
  const model = objectiveModel as { dimensions: Record<string, Record<string, { value: unknown; strength: string }>> };
  const participantIds = Object.keys(presence.participants);

  return (
    <div style={{ padding: 12, borderLeft: '1px solid #ddd', width: 280 }}>
      <h3>Alignment</h3>
      {Object.entries(DIMENSION_LABELS).map(([dimId, label]) => {
        const status = dimensionStatus[dimId];
        const positions = model.dimensions?.[dimId] ?? {};
        return (
          <div key={dimId} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{label}</strong>
              <span style={{ color: badgeColor(status?.status ?? 'open'), fontSize: 12 }}>{status?.status ?? 'open'}</span>
            </div>
            {participantIds.map((id) => {
              const pos = positions[id];
              const label = presence.participants[id]?.displayName ?? id;
              return (
                <div key={id} style={{ fontSize: 12, color: '#555' }}>
                  {label}: {pos ? `${JSON.stringify(pos.value)} (${pos.strength})` : '—'}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
