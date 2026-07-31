import { describe, expect, it } from 'vitest';
import { joinUrl, stageUrl, viewUrl } from '../src/lib/urls.ts';
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

describe('stageUrl', () => {
  it('is a page of its own, addressing no particular guest', () => {
    const url = new URL(stageUrl('https://ngobrolin.example.com', 'tok'));
    expect(url.pathname).toBe('/stage');
    expect(url.searchParams.get('t')).toBe('tok');
    expect(url.searchParams.get('id')).toBeNull();
  });

  it('is one URL for the whole show', () => {
    expect(stageUrl('https://x.test', 'tok')).toBe('https://x.test/stage?t=tok');
  });

  it('keeps a base path prefix, like every other link', () => {
    expect(stageUrl('https://x.test/ngobrolin/', 'tok')).toBe('https://x.test/ngobrolin/stage?t=tok');
  });

  it('tolerates a base with or without a trailing slash', () => {
    expect(stageUrl('http://localhost:4321/', 'tok')).toBe(stageUrl('http://localhost:4321', 'tok'));
  });

  /**
   * The load-bearing one. Every OBS scene the captain has saved points at `/view`, and
   * the composed stage is an addition, not a replacement: it may not move a byte of
   * either existing URL, and it must not be reachable by hand-editing one of them.
   */
  it('does not touch either per-guest URL', () => {
    expect(viewUrl('https://ngobrolin.example.com', 'budi-santoso', 'tok')).toBe(
      'https://ngobrolin.example.com/view?id=budi-santoso&t=tok',
    );
    expect(viewUrl('https://ngobrolin.example.com', 'budi-santoso', 'tok', 'screen')).toBe(
      'https://ngobrolin.example.com/view?id=budi-santoso&source=screen&t=tok',
    );
    expect(stageUrl('https://x.test', 'tok')).not.toContain('/view');
  });
});
