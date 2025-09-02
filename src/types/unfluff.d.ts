declare module 'unfluff' {
  export type UnfluffData = { title?: string; softTitle?: string; text?: string };
  type UnfluffFn = (html: string) => UnfluffData;
  const unfluff: UnfluffFn;
  export default unfluff;
}
