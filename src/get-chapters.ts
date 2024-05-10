import { Page } from 'puppeteer';
import { urlToChapter } from './url-to-chapter-id';

export async function getChapterUrls(page: Page): Promise<string[]> {
  await page.waitForSelector('iframe#contentframe');
  const contentPage = await page.$eval(
    'iframe#contentframe',
    (iframe) => iframe.src
  );
  await page.goto(contentPage, { waitUntil: 'networkidle2' });

  await page.waitForSelector('a.navlink.chunklink');
  await page.$eval('a.navlink.chunklink', (link) => link.click()); // weird fix, the links were wrong until clicked
  let urls = await page.$$eval('a.navlink.chunklink', (links) =>
    links.map((link) => link.href)
  );
  urls = urls.filter((url) => /^[0-9]+\.[0-9]+\.1$/.test(urlToChapter(url)));
  return urls;
}
