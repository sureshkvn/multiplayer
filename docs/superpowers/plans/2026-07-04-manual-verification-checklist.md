# v0 Manual Verification Checklist

## Verified in the sandbox during implementation (no ANTHROPIC_API_KEY available there)

- [x] `npm run dev` boots the ephemeral Temporal server, the worker, and the gateway from a single command (confirmed via `dist/dev-server.log`: "Starting ephemeral Temporal server..." → "Gateway listening on ws://localhost:8080" → "Ready: ...")
- [x] React client (`npm run dev --workspace client`) renders the join screen with a pre-filled session code and a disabled-until-named-entered Join button
- [x] Joining starts a new Temporal workflow, signals `join`, and hydrates the client via the `getState` query — confirmed the alignment sidebar renders all 4 dimensions as `open` with the joining participant listed
- [x] A second participant ("Bob") joining the same session via an independent WebSocket connection triggers a live push to the first participant's already-open tab — confirmed the presence bar and alignment sidebar updated without a page reload
- [x] Presence correctly distinguishes connected vs. disconnected participants (a stale connection from an accidental page reload showed dimmed, the fresh one full-opacity) rather than removing them
- [x] Found and fixed two real bugs this way: (1) `objectiveModel`/`presence` Map fields were not being serialized to plain objects before crossing the Temporal query / WebSocket JSON boundary, which would have silently dropped all position and presence data; (2) the alignment sidebar was displaying raw participant UUIDs instead of resolved display names

## Requires your own environment (needs `ANTHROPIC_API_KEY`, not available in the sandbox that implemented this plan)

### Setup
- [ ] `ANTHROPIC_API_KEY` is set in the environment
- [ ] `npm install` at repo root (installs both root and `client` workspace)
- [ ] Terminal 1: `npm run dev` — wait for "Ready: gateway on ws://localhost:8080, Temporal worker running."
- [ ] Terminal 2: `npm run dev --workspace client` — wait for the Vite local URL

### Scripted conversation (3 browser tabs)
- [ ] Tab 1: join session code `japan-trip-demo` as "Alice"
- [ ] Tab 2: join the same session code as "Bob"
- [ ] Tab 3: join the same session code as "Carol"
- [ ] Confirm all 3 names appear in the presence bar in every tab
- [ ] Alice: "I'm thinking dates Dec 20-28, budget around $1500-2500 per person"
- [ ] Bob: "Works for me, same dates and budget"
- [ ] Carol: "Sounds good, I'm flexible on dates and budget too"
- [ ] Confirm the alignment sidebar shows `dates` and `budget` as `aligned` in all 3 tabs once all 3 have stated a position
- [ ] Alice: "I really want to see Tokyo, Kyoto, and Osaka"
- [ ] Bob: "Same, Tokyo Kyoto Osaka works"
- [ ] Carol: "Tokyo, Kyoto, Osaka for me too"
- [ ] Confirm `places` shows `aligned`
- [ ] Alice: "let's fly ANA"
- [ ] Bob: "ANA works"
- [ ] Carol: "ANA for me too"
- [ ] Confirm all 4 dimensions read `aligned`, and within a few seconds the agent posts an unprompted finalized itinerary message (or a pushback message if the mock-KB cost estimate exceeds $2500/person) — **in all 3 tabs**, without anyone explicitly asking the agent to finalize
- [ ] In Tab 1, type "hey agent, what do you think of Osaka?" and confirm a reactive response appears promptly, distinct from the earlier proactive one

### Regression checks
- [ ] A purely social message ("thanks everyone!") does not get an agent response and does not appear in the alignment sidebar as a new position
- [ ] Closing Tab 3 (Carol) updates the presence bar in the remaining tabs to show Carol as disconnected

### Also worth (re-)running on a machine with unrestricted network access
- [ ] `npm test` — specifically confirm `src/workflows/session.workflow.test.ts` passes (it depends on downloading a Temporal test-server binary from `temporal.download`, which was unreachable at the start of the sandbox session that built this plan but became reachable later — worth a clean-cache re-run to be sure)
