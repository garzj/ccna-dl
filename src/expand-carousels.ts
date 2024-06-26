import { ElementHandle, Page } from 'puppeteer';
import { waitForSpinners } from './wait-for-spinners';
import { clickInBackground } from './click-in-bg';

export async function expandCarousels(page: Page) {
  const mbars = await page.$$(
    '*:has(>.mbar-buttons-wrapper, >.mbar-content-wrapper)'
  );
  for (const mbar of mbars) {
    const id = await mbar.evaluate(
      (mbar) => `.${Array.from(mbar.classList).join('.')}`
    );
    const btns = (await mbar.$$(
      '.mbar-buttons-wrapper > .mbar-button'
    )) as ElementHandle<HTMLButtonElement>[];

    const waitForContent = async () => {
      const contentWrapper = await mbar.$('.mbar-content-wrapper');
      if (!contentWrapper) {
        throw `No content wrapper found for mbar: ${id}`;
      }
      await page.waitForNetworkIdle();
      await waitForSpinners(contentWrapper);
    };

    for (let i = 1; i < btns.length; i++) {
      const btn = btns[i];
      await clickInBackground(btn);
      mbar.evaluate((mbar) => {
        (window as any).mbar = mbar;
      });
      await waitForContent();
      await mbar.evaluate(async (mbar) => {
        const content = mbar.querySelector('.mbar-content-wrapper')!;
        const cloned = content.cloneNode(true);
        mbar.parentElement!.appendChild(cloned);
      });
    }
    await clickInBackground(btns[0]);
    await waitForContent();
  }
}
