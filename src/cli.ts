#!/usr/bin/env node

import './config/env';

import {
  command,
  number,
  option,
  optional,
  restPositionals,
  run,
  string,
} from 'cmd-ts';
import { readFileSync } from 'fs';
import { join } from 'path';
import puppeteer, { HTTPResponse, PaperFormat, Target } from 'puppeteer';
// @ts-ignore
import { _paperFormats as paperFormats } from 'puppeteer-core';
import { catchedRace, delay, promisePool } from './util/promise';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as muhammara from 'muhammara';
import * as cliProgress from 'cli-progress';
import * as inquirer from 'inquirer';
import { hasOwnProperty } from './util/object';
import { waitForSpinners } from './wait-for-spinners';

const { version } = JSON.parse(
  readFileSync(join(__dirname, '../package.json')).toString()
);

function urlToChapter(url: string) {
  const chapter = url.match(/[0-9]+\.[0-9]+\.[0-9]+/)?.at(0);
  if (!chapter) throw `Could not determine chapter from url: ${url}`;
  return chapter;
}

const cmd = command({
  name: 'ccna-dl',
  description:
    'CCNA Downloader\n' +
    '> Downloads courses from https://netacad.com/' +
    version,
  args: {
    urls: restPositionals({
      displayName: 'urls',
      type: string,
      description: 'The urls to the courses you want to download.',
    }),
    user: option({
      long: 'user',
      short: 'u',
      type: string,
      description: 'Your login email/username.',
    }),
    password: option({
      long: 'password',
      short: 'p',
      type: optional(string),
      description: 'Your login password.',
    }),
    concurrency: option({
      long: 'concurrency',
      short: 'c',
      type: number,
      defaultValue: () => 10,
      description: 'Specifies the maximum amount of pages downloaded at once.',
    }),
    outDir: option({
      long: 'out-dir',
      short: 'o',
      type: string,
      defaultValue: () => '.',
      description: 'The directory, the item should be saved into.',
    }),
    format: option({
      long: 'format',
      type: optional(string),
      description: 'A puppeteer page format like "a4".',
    }),
    timeout: option({
      long: 'timeout',
      short: 't',
      type: optional(number),
      description: 'Terminates the download, when exceeded.',
    }),
  },
  handler: async (args) => {
    if (args.format && !hasOwnProperty(paperFormats, args.format)) {
      console.error(
        `Invalid page format specified. Possible options are: ${JSON.stringify(
          Object.keys(paperFormats)
        )}`
      );
      return;
    }

    if (args.urls.length < 1) {
      console.error('Please specify at least one url leading to a course.');
      return;
    }

    let password: string;
    if (args.password) {
      password = args.password;
    } else {
      password =
        process.env.PASSWORD ??
        (
          await inquirer.prompt({
            name: 'password',
            type: 'password',
          })
        ).password;
      console.log('');
    }

    const browser = await puppeteer.launch({
      headless: 'new',
    });
    try {
      for (const url of args.urls) {
        const page = await browser.newPage();

        let urls: string[];
        try {
          await page.goto(url, { waitUntil: 'networkidle2' });
          await waitForSpinners(page);

          // login
          console.log('Loggin in.');

          const userElm = await page.$('input[name="username"]');
          if (!userElm) throw 'Username input not found.';
          await userElm.type(args.user);

          const nextBtn = await page.$('#idp-discovery-submit');
          if (!nextBtn) {
            throw 'No next button found.';
          }

          // navigation
          const waitForNav = () =>
            page.waitForNavigation({ waitUntil: 'networkidle2' });

          // cookie banner
          const waitForCookies = () =>
            page.waitForSelector(
              '.save-preference-btn-handler.onetrust-close-btn-handler',
              { visible: true, hidden: false }
            );

          // https://www.cisco.com/c/en/us/about/legal/privacy-full.html page
          const waitForPrivacyPage = () =>
            browser.waitForTarget((target) =>
              target.url().includes('about/legal/privacy-full.html')
            );

          // handle multiple scenarios
          nextBtn.click();
          let nextThing = await catchedRace([
            waitForNav(),
            waitForCookies(),
            waitForPrivacyPage(),
          ]);
          // privacy page
          if (nextThing instanceof Target) {
            const page = await nextThing.page();
            page && (await page.close());

            nextBtn.click();
            nextThing = await catchedRace([waitForNav(), waitForCookies()]);
          }

          // cookie banner
          if (!(nextThing instanceof HTTPResponse)) {
            const savePrefsBtn = nextThing;
            if (savePrefsBtn) {
              await savePrefsBtn.click();
              await delay(1000);

              nextBtn.click();
              await waitForNav();
            }
          }

          await delay(2000);
          await waitForSpinners(page);

          const pwElm = await page.$('input[name="password"]');
          if (!pwElm) throw 'Password input not found.';
          await pwElm.type(password);

          const submitBtn = await page.$('#okta-signin-submit');
          if (!submitBtn) throw 'Login submit button not found.';
          submitBtn.click();

          // get all chapters
          console.log('Collecting course chapters.');

          await page.waitForNavigation({ waitUntil: 'networkidle2' });
          await page.waitForSelector('iframe#contentframe');
          const contentPage = await page.$eval(
            'iframe#contentframe',
            (iframe) => iframe.src
          );
          await page.goto(contentPage, { waitUntil: 'networkidle2' });

          await page.waitForSelector('a.navlink.chunklink');
          await page.$eval('a.navlink.chunklink', (link) => link.click()); // weird fix, the links were wrong until clicked
          urls = await page.$$eval('a.navlink.chunklink', (links) =>
            links.map((link) => link.href)
          );
          urls = urls.filter((url) =>
            /^[0-9]+\.[0-9]+\.1$/.test(urlToChapter(url))
          );

          // hide sidebar
          const sidebarVisible = !!(await page.$('.sidebar.isVisible'));
          if (sidebarVisible) {
            const toggleBtn = await page.$('button.nav-toggle');
            if (!toggleBtn) throw 'No button element to hide sidebar found.';
            await toggleBtn.click();
          }
        } catch (e) {
          console.error('Error:', e);
          return;
        } finally {
          await page.close();
        }

        // download into pdfs
        console.log('Downloading chapters.');

        const courseId = url.match(/[0-9]+/)?.at(0);
        if (!courseId) throw `No course id found in url: ${url}`;
        const saveDir = join(args.outDir, courseId);
        await rm(saveDir, { recursive: true, force: true });
        await mkdir(saveDir, { recursive: true });

        let outFiles = new Array(urls.length);

        // progress bar
        const bar = new cliProgress.SingleBar(
          {},
          cliProgress.Presets.shades_classic
        );
        bar.start(urls.length, 0);
        const barUpdater = setInterval(() => bar.updateETA(), 1000);

        await promisePool(
          async (i) => {
            const chapterUrl = urls[i];

            const page = await browser.newPage();
            try {
              await page.goto(chapterUrl, { waitUntil: 'networkidle2' });

              await page.waitForSelector('.content-chunks');
              await waitForSpinners(page);

              const chapter = urlToChapter(chapterUrl).replace(/\.1$/, '');
              const outFile = join(saveDir, `${chapter}.pdf`);
              const buf = await page.pdf({
                format: (args.format as PaperFormat | undefined) ?? 'a4',
                landscape: false,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                scale: 0.6,
                printBackground: true,
                displayHeaderFooter: false,
                timeout: args.timeout,
              });
              await writeFile(outFile, buf);
              outFiles[i] = outFile;

              // display progress
              bar.increment();
            } finally {
              await page.close();
            }
          },
          args.concurrency,
          urls.length
        );

        // stop progress
        clearInterval(barUpdater);
        bar.stop();

        // merge pdfs
        console.log('Merging pdfs.');

        const mergedPdf = join(args.outDir, `${courseId}.pdf`);
        const writeStream = new muhammara.PDFWStreamForFile(mergedPdf);
        const writer = muhammara.createWriter(writeStream);
        for (const outFile of outFiles) {
          writer.appendPDFPagesFromPDF(outFile);
        }
        writer.end();
        await new Promise<void>((resolve) => writeStream.close(resolve));

        await rm(saveDir, { recursive: true });

        console.log(`Success. File: ${mergedPdf}`);
      }
    } finally {
      await browser?.close();
    }
  },
});

run(cmd, process.argv.slice(2));
