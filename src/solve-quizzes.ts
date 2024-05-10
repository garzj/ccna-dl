import { Page } from 'puppeteer';
import { clickInBackground } from './click-in-bg';

export async function solveQuizzes(page: Page) {
  const quizContainer = await page.$('form.cyu-quiz-container');
  if (!quizContainer) return;

  const formCtls = await quizContainer.$('.form-controls');
  if (!formCtls) return;

  const showBtn = await formCtls.$('button.btn:nth-child(2)');
  showBtn && (await clickInBackground(showBtn));

  const checkBtn = await formCtls.$('button.btn:nth-child(1)');
  checkBtn && (await clickInBackground(checkBtn));
}
