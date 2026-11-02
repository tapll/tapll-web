import { describe, expect, it } from 'vitest';
import { start, useEnv } from './helpers';

const env = useEnv('https://example.com/docs');

function click(html: string, selector = '#t') {
  const { win } = env();
  win.document.body.innerHTML = html;
  const el = win.document.querySelector(selector)!;
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}
const names = () => env().events().filter((e) => e.name !== '$pageview');

describe('outbound and download', () => {
  it('$outbound for a link to another host, with url_host only', async () => {
    const { api } = start();
    click('<a id="t" href="https://other.org/path?token=secret#x">go</a>');
    await api.flush();
    const [e] = names();
    expect(e.name).toBe('$outbound');
    expect(e.properties).toEqual({ url_host: 'other.org' });
    expect(JSON.stringify(e)).not.toContain('secret');
  });

  it('fires from a child element of the link', async () => {
    const { api } = start();
    click('<a href="https://other.org/"><span><b id="t">go</b></span></a>');
    await api.flush();
    expect(names()[0].name).toBe('$outbound');
  });

  it('same host (also www and relative links) is not outbound', async () => {
    const { api } = start();
    click('<a id="t" href="https://example.com/x">a</a>');
    click('<a id="t" href="https://www.example.com/x">a</a>');
    click('<a id="t" href="/relative">a</a>');
    click('<a id="t" href="#top">a</a>');
    await api.flush();
    expect(names()).toHaveLength(0);
  });

  it('mailto:, tel: and javascript: are ignored', async () => {
    const { api } = start();
    for (const h of ['mailto:a@b.co', 'tel:+1', 'javascript:void(0)']) click(`<a id="t" href="${h}">a</a>`);
    await api.flush();
    expect(names()).toHaveLength(0);
  });

  it('$download for every listed extension, case-insensitive, query ignored, any host', async () => {
    const { api } = start();
    const exts = 'pdf zip dmg exe csv xlsx docx pptx mp4 mp3 pkg apk ipa'.split(' ');
    for (const x of exts) click(`<a id="t" href="/files/report.${x.toUpperCase()}?v=1">d</a>`);
    click('<a id="t" href="https://cdn.other.org/a.pdf">d</a>');
    await api.flush();
    const downloads = names();
    expect(downloads.map((e) => e.name)).toEqual(Array(exts.length + 1).fill('$download'));
    expect(downloads.map((e) => e.properties.file_ext)).toEqual([...exts, 'pdf']);
  });

  it('a non-listed extension on the same host is nothing', async () => {
    const { api } = start();
    click('<a id="t" href="/file.txt">d</a>');
    click('<a id="t" href="/pdf">d</a>');
    await api.flush();
    expect(names()).toHaveLength(0);
  });

  it('data-auto="false" turns both off', async () => {
    const { api } = start({ auto: 'false' });
    click('<a id="t" href="https://other.org/">a</a>');
    click('<a id="t" href="/a.pdf">a</a>');
    await api.flush();
    expect(names()).toHaveLength(0);
  });
});

describe('data-tapll-event', () => {
  it('tracks the named event on click', async () => {
    const { api } = start();
    click('<button id="t" data-tapll-event="signup_clicked">Sign up</button>');
    await api.flush();
    expect(names()).toMatchObject([{ name: 'signup_clicked', screen: '/docs' }]);
  });

  it('with data-tapll-feature and data-tapll-role', async () => {
    const { api } = start();
    click('<div data-tapll-event="pricing_cta" data-tapll-feature="pricing" data-tapll-role="start"><span id="t">x</span></div>');
    await api.flush();
    expect(names()[0]).toMatchObject({ name: 'pricing_cta', feature: 'pricing', role: 'start' });
  });

  it('works with data-auto="false"', async () => {
    const { api } = start({ auto: 'false' });
    click('<button id="t" data-tapll-event="still_tracked">x</button>');
    await api.flush();
    expect(names()[0].name).toBe('still_tracked');
  });

  it('an invalid name, feature or role drops the event with a warning', async () => {
    const { api } = start();
    click('<button id="t" data-tapll-event="Bad Name">x</button>');
    click('<button id="t" data-tapll-event="ok_name" data-tapll-feature="Bad">x</button>');
    click('<button id="t" data-tapll-event="ok_name" data-tapll-role="boss">x</button>');
    await api.flush();
    expect(names()).toHaveLength(0);
    expect(env().warn).toHaveBeenCalled();
  });

  it('a tagged link also records the outbound click', async () => {
    const { api } = start();
    click('<a id="t" href="https://other.org" data-tapll-event="partner_click">x</a>');
    await api.flush();
    expect(names().map((e) => e.name).sort()).toEqual(['$outbound', 'partner_click']);
  });
});
