import { switchToSurface } from '../support/surfaces';

describe('LightBridge native surfaces', () => {
  it('shows the themed overlay only after readiness and exposes core surfaces', async () => {
    await switchToSurface('main');
    const privacyTitle = await $(
      '//*[normalize-space(text())="Your screen stays private until Send"]',
    );
    await privacyTitle.waitForDisplayed();

    const transparentRoots = await browser.execute(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(transparentRoots.html).toBe('rgba(0, 0, 0, 0)');
    expect(transparentRoots.body).toBe('rgba(0, 0, 0, 0)');

    await $('//button[contains(normalize-space(.), "I understand")]').click();
    await privacyTitle.waitForDisplayed({ reverse: true });

    await expect(
      $('//*[contains(normalize-space(.), "Connect a model provider")]'),
    ).toBeDisplayed();
    await expect($('button[aria-label="New conversation"]')).toBeDisplayed();
    await expect($('button[aria-label="Recapture"]')).toBeDisplayed();

    await $('button[aria-label="History and captures"]').click();
    await expect(
      $('//*[contains(normalize-space(.), "History and context")]'),
    ).toBeDisplayed();
    await expect(
      $('//button[contains(normalize-space(.), "Captures")]'),
    ).toBeDisplayed();
    await expect(
      $('//button[contains(normalize-space(.), "Search")]'),
    ).toBeDisplayed();
    await $('button[aria-label="Close"]').click();
  });

  it('opens the dedicated settings window with complete navigation', async () => {
    await switchToSurface('main');
    const initialHandle = await browser.getWindowHandle();
    await $('button[aria-label="Settings"]').click();

    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length >= 2,
      { timeout: 10_000, timeoutMsg: 'Settings window was not created.' },
    );
    await switchToSurface('settings');
    await expect($('//*[normalize-space(text())="Overview"]')).toBeDisplayed();
    await expect($('//*[normalize-space(text())="Providers"]')).toBeDisplayed();
    await expect(
      $('//*[normalize-space(text())="Models and routes"]'),
    ).toBeDisplayed();
    await expect($('//*[normalize-space(text())="Overlay"]')).toBeDisplayed();
    await expect($('//*[normalize-space(text())="Appearance"]')).toBeDisplayed();
    await expect(
      $('//*[normalize-space(text())="Capture and privacy"]'),
    ).toBeDisplayed();
    await expect(
      $('//*[normalize-space(text())="Data and updates"]'),
    ).toBeDisplayed();
    await browser.switchToWindow(initialHandle);
  });
});
