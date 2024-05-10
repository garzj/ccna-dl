export function urlToChapter(url: string) {
  const chapter = url.match(/[0-9]+\.[0-9]+\.[0-9]+/)?.at(0);
  if (!chapter) throw `Could not determine chapter from url: ${url}`;
  return chapter;
}
