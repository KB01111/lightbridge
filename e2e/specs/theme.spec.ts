import { switchToSurface } from '../support/surfaces';

type ThemeSnapshot = {
  dataTheme: string;
  colorScheme: string;
  backgroundBody: string;
  textPrimary: string;
};

async function readThemeSnapshot(): Promise<ThemeSnapshot> {
  return browser.execute(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      dataTheme: document.documentElement.getAttribute('data-theme') ?? '',
      colorScheme: styles.colorScheme,
      backgroundBody: styles.getPropertyValue('--color-background-body').trim(),
      textPrimary: styles.getPropertyValue('--color-text-primary').trim(),
    };
  });
}

// Mirrors the WCAG relative-luminance/contrast-ratio formulas so the check
// below reacts to real token values instead of a hardcoded pass.
function contrastScript() {
  const styles = getComputedStyle(document.documentElement);
  const parseHex = (hex: string): [number, number, number] => {
    const clean = hex.trim().replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const relativeLuminance = ([r, g, b]: readonly number[]) => {
    const [rl, gl, bl] = [r, g, b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  };
  const contrastRatio = (a: readonly number[], b: readonly number[]) => {
    const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort(
      (x, y) => y - x,
    );
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const composite = (
    fgHex: string,
    alpha: number,
    backdrop: readonly [number, number, number],
  ): [number, number, number] => {
    const fg = parseHex(fgHex);
    return [0, 1, 2].map(
      (i) => fg[i] * alpha + backdrop[i] * (1 - alpha),
    ) as [number, number, number];
  };
  // Same formula the app-shell `backgroundColor` uses in theme.ts:
  // color-mix(in srgb, var(--color-background-surface) <opacity>, transparent)
  // resolves to the surface color with alpha = opacity / 100.
  const opacity =
    parseFloat(styles.getPropertyValue('--lightbridge-panel-opacity')) / 100;
  const surfaceHex = styles.getPropertyValue('--color-background-surface');
  const textHex = styles.getPropertyValue('--color-text-primary');
  const textRgb = parseHex(textHex);
  // The overlay window itself is transparent, so whatever sits behind the
  // panel (the desktop) is unknown; check both plausible worst-case
  // backdrops instead of assuming a specific one.
  return {
    opacity,
    contrastOnBlack: contrastRatio(textRgb, composite(surfaceHex, opacity, [0, 0, 0])),
    contrastOnWhite: contrastRatio(
      textRgb,
      composite(surfaceHex, opacity, [255, 255, 255]),
    ),
  };
}

describe('LightBridge theme and overlay opacity', () => {
  it('switches computed theme tokens between dark and light mode', async () => {
    await switchToSurface('main');
    const dark = await readThemeSnapshot();
    expect(dark.dataTheme).toBe('dark');
    expect(dark.colorScheme).toBe('dark');
    expect(dark.backgroundBody.length).toBeGreaterThan(0);

    await switchToSurface('settings');
    await $('//*[normalize-space(text())="Appearance"]').click();
    const colorMode = await $(
      '//button[.="Graphite Aurora" or contains(., "Graphite Aurora")]',
    );
    await colorMode.waitForDisplayed();
    await colorMode.click();
    const lightOption = await $(
      '//*[@role="option"][contains(., "Aurora Light")]',
    );
    await lightOption.waitForDisplayed();
    await lightOption.click();

    await switchToSurface('main');
    await browser.waitUntil(
      async () => (await readThemeSnapshot()).dataTheme === 'light',
      { timeout: 10_000, timeoutMsg: 'Overlay did not switch to light mode.' },
    );
    const light = await readThemeSnapshot();
    expect(light.colorScheme).toBe('light');
    expect(light.backgroundBody).not.toBe(dark.backgroundBody);
    expect(light.textPrimary).not.toBe(dark.textPrimary);

    // Restore dark mode so later specs see the default theme.
    await switchToSurface('settings');
    const colorModeAgain = await $(
      '//button[.="Aurora Light" or contains(., "Aurora Light")]',
    );
    await colorModeAgain.click();
    const darkOption = await $(
      '//*[@role="option"][contains(., "Graphite Aurora")]',
    );
    await darkOption.waitForDisplayed();
    await darkOption.click();
    await switchToSurface('main');
    await browser.waitUntil(
      async () => (await readThemeSnapshot()).dataTheme === 'dark',
      { timeout: 10_000, timeoutMsg: 'Overlay did not restore dark mode.' },
    );
  });

  it('keeps the panel opacity variable in sync with the transparency slider', async () => {
    await switchToSurface('settings');
    await $('//*[normalize-space(text())="Overlay"]').click();
    const slider = await $('[role="slider"][aria-label="Panel transparency"]');
    await slider.waitForDisplayed();
    await slider.click();
    await browser.keys(['Home']);
    await browser.waitUntil(
      async () => (await slider.getAttribute('aria-valuenow')) === '72',
      { timeout: 5_000 },
    );

    await switchToSurface('main');
    await browser.waitUntil(
      async () => {
        const value = await browser.execute(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--lightbridge-panel-opacity')
            .trim(),
        );
        return value === '72%';
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Overlay opacity variable did not follow the slider to its minimum.',
      },
    );

    await switchToSurface('settings');
    await slider.click();
    await browser.keys(['End']);
    await browser.waitUntil(
      async () => (await slider.getAttribute('aria-valuenow')) === '100',
      { timeout: 5_000 },
    );
    await switchToSurface('main');
    await browser.waitUntil(
      async () => {
        const value = await browser.execute(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--lightbridge-panel-opacity')
            .trim(),
        );
        return value === '100%';
      },
      {
        timeout: 10_000,
        timeoutMsg: 'Overlay opacity variable did not follow the slider to its maximum.',
      },
    );
  });

  it('keeps text-on-panel contrast at or above WCAG AA at the minimum overlay opacity', async () => {
    await switchToSurface('settings');
    await $('//*[normalize-space(text())="Overlay"]').click();
    const slider = await $('[role="slider"][aria-label="Panel transparency"]');
    await slider.waitForDisplayed();
    await slider.click();
    await browser.keys(['Home']);
    await browser.waitUntil(
      async () => (await slider.getAttribute('aria-valuenow')) === '72',
      { timeout: 5_000 },
    );

    await switchToSurface('main');
    await browser.waitUntil(
      async () => {
        const value = await browser.execute(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--lightbridge-panel-opacity')
            .trim(),
        );
        return value === '72%';
      },
      { timeout: 10_000, timeoutMsg: 'Overlay did not reach minimum opacity.' },
    );

    const { opacity, contrastOnBlack, contrastOnWhite } =
      await browser.execute(contrastScript);
    expect(opacity).toBeCloseTo(0.72, 5);
    expect(contrastOnBlack).toBeGreaterThanOrEqual(4.5);
    expect(contrastOnWhite).toBeGreaterThanOrEqual(4.5);

    // Restore full opacity so later specs see the default overlay state.
    await switchToSurface('settings');
    await slider.click();
    await browser.keys(['End']);
    await browser.waitUntil(
      async () => (await slider.getAttribute('aria-valuenow')) === '100',
      { timeout: 5_000 },
    );
  });
});
