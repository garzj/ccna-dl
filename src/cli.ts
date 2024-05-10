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
import puppeteer, { PaperFormat } from 'puppeteer';
// @ts-ignore
import { _paperFormats as paperFormats } from 'puppeteer-core';
import { promisePool } from './util/promise';
import { mkdir, rm, writeFile } from 'fs/promises';
import * as muhammara from 'muhammara';
import * as cliProgress from 'cli-progress';
import * as inquirer from 'inquirer';
import { hasOwnProperty } from './util/object';
import { expandCarousels } from './expand-carousels';
import { waitForSpinners } from './wait-for-spinners';
import sanitize = require('sanitize-filename');
import { login } from './login';
import { getChapterUrls } from './get-chapters';
import { urlToChapter as urlToChapterId } from './url-to-chapter-id';
import { solveQuizzes } from './solve-quizzes';

const { version } = JSON.parse(
  readFileSync(join(__dirname, '../package.json')).toString()
);

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
      headless: true,
      args: [
        '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    try {
      for (const url of args.urls) {
        const page = await browser.newPage();

        let urls: string[];
        let courseTitle: string;
        try {
          await page.goto(url, { waitUntil: 'networkidle2' });
          await waitForSpinners(page);

          // login
          console.log('Loggin in.');

          await login(page, args.user, password);

          // get all chapters
          console.log('Collecting course chapters.');

          urls = await getChapterUrls(page);

          // get course title
          courseTitle =
            (await page.$eval('.page-title', (title) => title.textContent)) ??
            'Unknown';

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

              await expandCarousels(page);
              await solveQuizzes(page);

              const chapter = urlToChapterId(chapterUrl).replace(/\.1$/, '');
              const outFile = join(saveDir, `${chapter}.pdf`);
              // await page.emulateMediaType('screen');
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

        const mergedPdf = join(
          args.outDir,
          `${courseId}_${sanitize(courseTitle)}.pdf`
        );
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
