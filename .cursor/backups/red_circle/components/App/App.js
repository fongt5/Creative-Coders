import { PhotoUploadSection } from '../PhotoUploadSection/PhotoUploadSection.js';

const React = globalThis.React;
const { createElement, useState } = React;

export function App() {
  const [referenceImage, setReferenceImage] = useState(null);
  const [artworkImage, setArtworkImage] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [annotatedImage, setAnnotatedImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!referenceImage || !artworkImage) return;
    setLoading(true);
    setError(null);
    setFeedback(null);
    setAnnotatedImage(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceImage,
          artworkImage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setFeedback(data.feedback || '');
      setAnnotatedImage(data.annotatedImage || null);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = referenceImage && artworkImage && !loading;

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
        preview: referenceImage,
        onPhotoChange: setReferenceImage,
      }),
      createElement(PhotoUploadSection, {
        id: 'artwork',
        title: 'Your Artwork',
        subtitle: 'Upload your own piece to compare or get feedback',
        preview: artworkImage,
        onPhotoChange: setArtworkImage,
      })
    ),
    createElement('button', {
      type: 'button',
      className: 'submit-btn',
      onClick: handleSubmit,
      disabled: !canSubmit,
      'aria-label': 'Submit reference and drawing',
    }, loading ? 'Analyzing…' : 'Submit'),
    error && createElement('div', { className: 'result-error', role: 'alert' }, error),
    feedback && createElement('section', { className: 'result-section', 'aria-labelledby': 'result-heading' },
      createElement('h2', { id: 'result-heading', className: 'result-title' }, 'Feedback on your drawing'),
      createElement('div', { className: 'result-box' },
        (annotatedImage || artworkImage) && createElement('div', { className: 'result-image-wrap' },
          createElement('img', {
            src: annotatedImage || artworkImage,
            alt: annotatedImage ? 'Annotated drawing with improvement markers' : 'Your drawing',
            className: 'result-image',
          }),
          annotatedImage && createElement('p', { className: 'result-image-caption' }, 'Annotated with improvement markers')
        ),
        createElement('div', {
          className: 'result-feedback',
          dangerouslySetInnerHTML: {
            __html: (globalThis.marked?.parse?.(String(feedback))) ?? String(feedback),
          },
        })
      )
    )
  );
}
