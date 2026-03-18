import React from 'react'
import { Button } from './ui/button';
import { Bell, CheckCheck, UserCircle2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const formatRelativeTime = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return 'vừa xong';
  }

  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)} phút trước`;
  }

  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)} giờ trước`;
  }

  return `${Math.floor(diffMs / day)} ngày trước`;
};

export const Header = ({
  appName = 'Task Management App',
  userName,
  onLogout,
  notificationCount = 0,
  workspaceName = 'Primary Workspace',
  workspaceNotifications = [],
  onMarkAllNotificationsRead,
  isMarkingNotificationsRead = false,
}) => {
  return <div className='space-y-3'>

    <div className='flex flex-col gap-3 rounded-2xl bg-transparent p-4 md:flex-row md:items-center md:justify-between'>
      <div className='space-y-1'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-800'>
          {workspaceName}
        </p>
        <h1 className='text-2xl font-black text-violet-900 sm:text-[2rem]'>
          {appName}
        </h1>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <div className='inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700'>
          <UserCircle2 className='size-4 text-slate-500' />
          <span className='font-medium'>{userName}</span>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              className='inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-violet-50'
            >
              <Bell className='size-4 text-primary' />
              <span>{notificationCount} notifications</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align='end'
            className='w-[360px] border-white/80 bg-white/75 p-3 shadow-xl backdrop-blur-xl supports-[backdrop-filter]:bg-white/65'
          >
            <div className='flex items-center justify-between gap-2'>
              <div>
                <p className='text-sm font-semibold text-slate-900'>Thông báo workspace</p>
                <p className='mt-0.5 text-xs text-slate-500'>Tổng hợp thay đổi lớn từ thành viên khác</p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='icon-sm'
                className='size-8 border-violet-200 bg-white hover:bg-violet-50'
                disabled={notificationCount === 0 || isMarkingNotificationsRead}
                onClick={onMarkAllNotificationsRead}
                aria-label='Đánh dấu tất cả đã xem'
                title='Đánh dấu tất cả đã xem'
              >
                <CheckCheck className='size-4' />
              </Button>
            </div>

            {workspaceNotifications.length === 0 ? (
              <p className='mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500'>
                Chưa có thông báo mới.
              </p>
            ) : (
              <div className='mt-3 max-h-72 space-y-2 overflow-y-auto pr-1'>
                {workspaceNotifications.map((item) => (
                  <div key={item.workspaceId} className='rounded-lg border border-violet-100 bg-violet-50/50 p-2.5'>
                    <p className='truncate text-sm font-semibold text-slate-900'>{item.workspaceName}</p>
                    <p className='mt-1 text-xs text-slate-700'>
                      {item.majorChangeCount > 0
                        ? `${item.workspaceName} có ${item.majorChangeCount} lần thay đổi lớn.`
                        : `${item.workspaceName} không có thay đổi lớn.`}
                    </p>
                    {item.newMemberCount > 0 ? (
                      <p className='mt-1 text-xs text-slate-700'>
                        {item.workspaceName} có thêm {item.newMemberCount} thành viên mới.
                      </p>
                    ) : null}
                    <p className='mt-1 text-[11px] text-slate-500'>{formatRelativeTime(item.latestActivityAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>

        <Button variant='outline' size='sm' className='cursor-pointer border-violet-200 bg-white hover:bg-violet-50' onClick={onLogout}>Logout</Button>
      </div>
    </div>

  </div>
}

export default Header