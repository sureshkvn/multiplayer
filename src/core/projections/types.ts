export interface StructuralEvent<P = unknown> {
  seq: number;
  type: string;
  payload: P;
  ts: number;
}

export interface Projection<S> {
  readonly name: string;
  initial(): S;
  apply(state: S, event: StructuralEvent): S;
  version(state: S): number;
}
