import { ElementHandle, Page, TimeoutError } from 'puppeteer';

// waits until all there is no .loading-spinner element left or max 10s
// (works only if there is at least one child element)
export async function waitForSpinners(elm: ElementHandle | Page) {
  try {
    await elm.waitForSelector(':scope:not(:has(.loading-spinner)) > *', {
      timeout: 10000,
    });
  } catch (e) {
    if (!(e instanceof TimeoutError)) {
      throw e;
    }
  }
}
