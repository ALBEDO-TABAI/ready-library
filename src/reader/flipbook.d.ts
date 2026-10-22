export type FlipView = { a: number; b: number; count: number; spread: boolean; cur: number; atStart: boolean; atEnd: boolean };
export function createFlipbook(o: {
  stage: HTMLElement; book: HTMLElement; count: number; page: (i: number) => HTMLElement; blank: () => HTMLElement;
  look: { css: string; root: string; paper: number[] }; onChange?: (v: FlipView) => void; startPage?: number; single?: boolean; params?: Record<string, number>;
  /** text can be selected in the text column (mouse) */
  selectable?: boolean;
  onSelect?: (sel: Selection, e: PointerEvent) => void;
  onMark?: (id: string, el: HTMLElement, e: PointerEvent) => void;
  onBusy?: (busy: boolean) => void;
  /** true swallows this click (it only closed a popover) */
  clickGuard?: () => boolean;
}): {
  readonly state: { spread: boolean; pw: number; cur: number; count: number; busy: boolean };
  readonly gl: boolean;
  readonly frameMs: number[];
  readonly ready: Promise<void>;
  next(vg?: number): Promise<void>; prev(vg?: number): Promise<void>; gotoPage(p: number): Promise<void>; page(): number;
  repaint(pages: number[]): void; selecting(on: boolean): void;
  refresh(look?: { css?: string; root?: string; paper?: number[] }): void; setSingle(on: boolean): void; suspendGL(on: boolean): void; dispose(): void;
};
