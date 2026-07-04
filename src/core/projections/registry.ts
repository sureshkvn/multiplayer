import type { Projection } from './types.js';
import type { SessionEvent } from '../events/types.js';

export class ProjectionRegistry {
  private states = new Map<string, unknown>();
  private byName = new Map<string, Projection<unknown>>();

  constructor(projections: Projection<unknown>[]) {
    for (const p of projections) {
      this.byName.set(p.name, p);
      this.states.set(p.name, p.initial());
    }
  }

  apply(event: SessionEvent): void {
    for (const [name, p] of this.byName) {
      this.states.set(name, p.apply(this.states.get(name), event));
    }
  }

  get<S>(name: string): S {
    return this.states.get(name) as S;
  }

  getVersion(name: string): number {
    const p = this.byName.get(name);
    if (!p) throw new Error(`Unknown projection: ${name}`);
    return p.version(this.states.get(name));
  }

  rebuild(log: Iterable<SessionEvent>): void {
    for (const [name, p] of this.byName) this.states.set(name, p.initial());
    for (const event of log) this.apply(event);
  }
}
