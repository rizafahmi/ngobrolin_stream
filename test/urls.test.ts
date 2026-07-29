import { describe, expect, it } from 'vitest';
import { joinUrl, viewUrl } from '../src/lib/urls.ts';

describe('joinUrl', () => {
  it('puts the token in the query string', () => {
    expect(joinUrl('https://ngobrolin.example.com', 'abc.def.ghi')).toBe(
      'https://ngobrolin.example.com/?t=abc.def.ghi',
    );
  });

  it('tolerates a base with or without a trailing slash', () => {
    expect(joinUrl('http://localhost:4321/', 'tok')).toBe(joinUrl('http://localhost:4321', 'tok'));
  });

  it('escapes tokens so a JWT cannot break the query string', () => {
    const url = new URL(joinUrl('https://x.test', 'a+b/c=='));
    expect(url.searchParams.get('t')).toBe('a+b/c==');
  });
});

describe('viewUrl', () => {
  it('names the participant in id and carries the viewer token in t', () => {
    const url = new URL(viewUrl('https://ngobrolin.example.com', 'budi-santoso', 'tok'));
    expect(url.pathname).toBe('/view');
    expect(url.searchParams.get('id')).toBe('budi-santoso');
    expect(url.searchParams.get('t')).toBe('tok');
  });

  it('produces the same URL for the same guest every time it is called', () => {
    expect(viewUrl('https://x.test', 'budi', 'tok')).toBe(viewUrl('https://x.test', 'budi', 'tok'));
  });

  it('keeps a base path prefix when the site is not at the domain root', () => {
    expect(viewUrl('https://x.test/ngobrolin/', 'budi', 'tok')).toBe(
      'https://x.test/ngobrolin/view?id=budi&t=tok',
    );
  });
});
