/**
 * PageForge FAQ.
 * Each row from the template is [question cell, answer cell].
 * Renders native <details> accordions: keyboard and screen-reader friendly,
 * and the answers stay in the HTML for search engines.
 */
export default function decorate(block) {
  const items = [...block.children].map((row) => {
    const [question, answer] = row.children;
    const details = document.createElement('details');
    details.className = 'faq-item';

    const summary = document.createElement('summary');
    summary.className = 'faq-question';
    summary.append(...(question?.childNodes || []));

    const body = document.createElement('div');
    body.className = 'faq-answer';
    body.append(...(answer?.childNodes || []));

    details.append(summary, body);
    return details;
  });

  block.replaceChildren(...items);
}
