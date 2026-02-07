const React = globalThis.React;
const { useState, useRef, createElement } = React;

export function PhotoUploadSection({ title, subtitle, id, preview: controlledPreview, onPhotoChange }) {
  const [localPreview, setLocalPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const preview = controlledPreview !== undefined ? controlledPreview : localPreview;
  const setPreview = onPhotoChange || setLocalPreview;

  const handleFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const onInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
  };

  const clearPhoto = (e) => {
    e.stopPropagation();
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const zoneClass = ['upload-zone', isDragging && 'dragging', preview && 'has-preview'].filter(Boolean).join(' ');

  return createElement(
    'section',
    { className: 'upload-section', 'aria-labelledby': `heading-${id}` },
    createElement('h2', { id: `heading-${id}`, className: 'upload-title' }, title),
    subtitle && createElement('p', { className: 'upload-subtitle' }, subtitle),
    createElement('div', {
      className: zoneClass,
      onDrop,
      onDragOver,
      onDragLeave,
      onClick: () => !preview && inputRef.current?.click(),
      role: 'button',
      tabIndex: 0,
      onKeyDown: (e) => e.key === 'Enter' && !preview && inputRef.current?.click(),
      'aria-label': `Upload ${title}`,
    },
      createElement('input', {
        ref: inputRef,
        type: 'file',
        accept: 'image/*',
        onChange: onInputChange,
        className: 'upload-input',
        'aria-hidden': 'true',
      }),
      preview
        ? createElement('div', { className: 'preview-wrap' },
            createElement('img', { src: preview, alt: `Preview for ${title}`, className: 'preview-img' }),
            createElement('button', {
              type: 'button',
              className: 'clear-btn',
              onClick: clearPhoto,
              'aria-label': 'Remove photo',
            }, 'Remove')
          )
        : createElement('div', { className: 'upload-placeholder' },
            createElement('span', { className: 'upload-icon', 'aria-hidden': 'true' }, '↑'),
            createElement('span', null, 'Drop an image here or click to browse')
          )
    )
  );
}
