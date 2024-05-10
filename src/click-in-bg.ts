import { ElementHandle } from 'puppeteer';

export async function clickInBackground(
  handle: ElementHandle<HTMLButtonElement>
) {
  await handle.evaluate((elm) => elm.click());
}
