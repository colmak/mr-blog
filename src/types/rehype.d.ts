declare module 'rehype-slug' {
  import type { Plugin } from 'unified';
  const plugin: Plugin<[]>;
  export default plugin;
}

declare module 'rehype-autolink-headings' {
  import type { Plugin } from 'unified';
  type Options = { behavior?: 'wrap' | 'append' | 'prepend' };
  const plugin: Plugin<[Options?]>;
  export default plugin;
}
