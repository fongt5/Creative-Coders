import { PhotoUploadSection } from '../PhotoUploadSection/PhotoUploadSection.js';

const React = globalThis.React;
const { createElement } = React;

export function App() {
  return createElement(
    'main',
    { className: 'app' },
    createElement('header', { className: 'header' },
      createElement('h1', { className: 'brand' }, 'AI Art Teacher'),
      createElement('p', { className: 'tagline' }, 'Upload your references and artwork for personalized feedback')
    ),
    createElement('div', { className: 'upload-grid' },
      createElement(PhotoUploadSection, {
        id: 'reference',
        title: 'Reference / Inspiration',
        subtitle: 'Upload an image you want to learn from or replicate',
      }),
      createElement(PhotoUploadSection, {
        id: 'artwork',
        title: 'Your Artwork',
        subtitle: 'Upload your own piece to compare or get feedback',
      })
    )
  );
}
