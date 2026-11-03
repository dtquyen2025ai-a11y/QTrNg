export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg: string, code = 'bad_request') => new HttpError(400, msg, code);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Không tìm thấy.') => new HttpError(404, msg, 'not_found');
export const tooMany = (msg: string) => new HttpError(429, msg, 'rate_limited');
