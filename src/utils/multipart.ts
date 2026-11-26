export interface MultipartPartRange {
  startByte: number;
  endByte: number;
}

export interface MultipartPartSlice extends MultipartPartRange {
  blob: Blob;
}

export function getMultipartPartRange(
  fileSize: number,
  partSize: number,
  partNumber: number
): MultipartPartRange {
  if (
    !Number.isSafeInteger(fileSize) ||
    !Number.isSafeInteger(partSize) ||
    !Number.isSafeInteger(partNumber) ||
    fileSize <= 0 ||
    partSize <= 0 ||
    partNumber <= 0
  ) {
    throw new RangeError('Multipart part range requires positive integer sizes and part number.');
  }

  const startByte = (partNumber - 1) * partSize;
  if (startByte >= fileSize) {
    throw new RangeError('Multipart part number is outside the file size.');
  }

  return {
    startByte,
    endByte: Math.min(startByte + partSize, fileSize),
  };
}

export function getMultipartPartSlice(
  file: Blob,
  partSize: number,
  partNumber: number
): MultipartPartSlice {
  const range = getMultipartPartRange(file.size, partSize, partNumber);
  return {
    ...range,
    blob: file.slice(range.startByte, range.endByte),
  };
}
