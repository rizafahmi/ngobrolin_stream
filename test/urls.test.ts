import { describe, expect, it } from 'vitest';
import { joinUrl, viewUrl } from '../src/lib/urls.ts';
import { VIEW_SOURCE_PARAM, parseViewSource } from '../src/lib/view-source.ts';

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

  /**
   * The captain has OBS scenes saved against these URLs on a live show. Adding a second
   * kind of source may not move a single byte of the first kind, so these assert the
   * whole literal string rather than parsed parts.
   */
  it('emits the camera URL byte for byte as it was before screen sharing existed', () => {
    expect(viewUrl('https://ngobrolin.example.com', 'budi-santoso', 'tok')).toBe(
      'https://ngobrolin.example.com/view?id=budi-santoso&t=tok',
    );
  });

  it('carries no source parameter at all for a camera', () => {
    expect(viewUrl('https://x.test', 'budi', 'tok')).not.toContain(VIEW_SOURCE_PARAM);
  });

  it('treats an explicit camera as the default, down to the bytes', () => {
    expect(viewUrl('https://x.test', 'budi', 'tok', 'camera')).toBe(
      viewUrl('https://x.test', 'budi', 'tok'),
    );
  });

  it('addresses the screen share with the same id, so one slug drives both sources', () => {
    const url = new URL(viewUrl('https://x.test', 'budi-santoso', 'tok', 'screen'));
    expect(url.pathname).toBe('/view');
    expect(url.searchParams.get('id')).toBe('budi-santoso');
    expect(url.searchParams.get('t')).toBe('tok');
    expect(url.searchParams.get(VIEW_SOURCE_PARAM)).toBe('screen');
  });

  it('round-trips through the parser the view page uses', () => {
    for (const source of ['camera', 'screen'] as const) {
      const url = new URL(viewUrl('https://x.test', 'budi', 'tok', source));
      expect(parseViewSource(url.searchParams.get(VIEW_SOURCE_PARAM))).toBe(source);
    }
  });

  it('gives the two sources different URLs, since they are different OBS sources', () => {
    expect(viewUrl('https://x.test', 'budi', 'tok', 'screen')).not.toBe(
      viewUrl('https://x.test', 'budi', 'tok', 'camera'),
    );
  });

  it('produces the same screen URL every time, so a scene built once keeps working', () => {
    expect(viewUrl('https://x.test', 'budi', 'tok', 'screen')).toBe(
      viewUrl('https://x.test', 'budi', 'tok', 'screen'),
    );
  });
});
