/**
 * Obsolete — kept only so that stale imports fail loudly rather than silently.
 *
 * This module used to wrap pi's `CustomEditor` and colourise the input area by
 * re-parsing its ANSI output line by line, with a private animation timer and
 * a render cache. All of that now happens one level up:
 *
 *   tui-hook.ts  intercepts the fully composited screen, once per frame
 *   layout.ts    finds pi's rule-delimited panels in it
 *   engine.ts    colours them in OKLab and runs the effect stack
 *
 * Doing it at the frame level fixed the things this file could not: the editor
 * is coloured in step with the rest of the chrome instead of drifting on its
 * own clock, and effects can cross the boundary between the editor and the
 * panels around it.
 *
 * The one piece of hard-won knowledge here was that pi's editor chrome is a run
 * of box-drawing dashes rather than a bordered box. That now lives in
 * `layout.ts` as `RULE_CHARS`, which is what the panel detection keys on.
 *
 * Safe to delete; it is referenced by nothing.
 */

export {};
