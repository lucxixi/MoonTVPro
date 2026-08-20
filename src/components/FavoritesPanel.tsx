/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { AlertTriangle, SlidersHorizontal, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Favorite } from '@/lib/db.client';
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import VideoCard from '@/components/VideoCard';

interface FavoriteItem {
  id: string;
  source: string;
  title: string;
  year: string;
  poster: string;
  episodes?: number;
  source_name?: string;
  currentEpisode?: number;
  search_title?: string;
  origin?: 'vod' | 'live';
  favorite: Favorite;
  shelfStatus: ShelfStatus;
}

type ShelfStatus = NonNullable<Favorite['shelf_status']>;
type PersonalRating = NonNullable<Favorite['personal_rating']>;
type ShelfFilter = 'all' | ShelfStatus;

const SHELF_STATUS_OPTIONS: Array<{ value: ShelfStatus; label: string }> = [
  { value: 'want', label: '想看' },
  { value: 'watching', label: '在看' },
  { value: 'completed', label: '看完' },
  { value: 'paused', label: '搁置' },
  { value: 'treasured', label: '珍藏' },
];

const PERSONAL_RATING_OPTIONS: Array<{
  value: PersonalRating;
  label: string;
}> = [
  { value: 'like', label: '喜欢' },
  { value: 'neutral', label: '一般' },
  { value: 'dislike', label: '不喜欢' },
];

interface FavoritesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FavoritesPanel: React.FC<FavoritesPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ShelfFilter>('all');
  const [editingItem, setEditingItem] = useState<FavoriteItem | null>(null);
  const [draftStatus, setDraftStatus] = useState<ShelfStatus>('want');
  const [draftRating, setDraftRating] = useState<PersonalRating | ''>('');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);

  // 加载收藏数据
  const loadFavorites = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const allFavorites = await getAllFavorites();
      const allPlayRecords = await getAllPlayRecords();

      // 根据保存时间排序（从近到远）
      const sorted = Object.entries(allFavorites)
        .sort(([, a], [, b]) => b.save_time - a.save_time)
        .map(([key, fav]) => {
          const plusIndex = key.indexOf('+');
          const source = key.slice(0, plusIndex);
          const id = key.slice(plusIndex + 1);

          // 查找对应的播放记录，获取当前集数
          const playRecord = allPlayRecords[key];
          const currentEpisode = playRecord?.index;
          const reachedEnding = Boolean(
            playRecord &&
              playRecord.total_episodes > 0 &&
              playRecord.index >= playRecord.total_episodes &&
              playRecord.total_time > 0 &&
              playRecord.play_time / playRecord.total_time >= 0.9
          );
          const shelfStatus: ShelfStatus =
            fav.shelf_status ||
            (reachedEnding ? 'completed' : playRecord ? 'watching' : 'want');

          return {
            id,
            source,
            title: fav.title,
            year: fav.year,
            poster: fav.cover,
            episodes: fav.total_episodes,
            source_name: fav.source_name,
            currentEpisode,
            search_title: fav?.search_title,
            origin: fav?.origin,
            favorite: fav,
            shelfStatus,
          } as FavoriteItem;
        });
      setFavoriteItems(sorted);
    } catch (error) {
      console.error('加载收藏失败:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const visibleItems = useMemo(
    () =>
      activeFilter === 'all'
        ? favoriteItems
        : favoriteItems.filter((item) => item.shelfStatus === activeFilter),
    [activeFilter, favoriteItems]
  );

  const filterCounts = useMemo(() => {
    const counts: Record<ShelfStatus, number> = {
      want: 0,
      watching: 0,
      completed: 0,
      paused: 0,
      treasured: 0,
    };
    favoriteItems.forEach((item) => {
      counts[item.shelfStatus] += 1;
    });
    return counts;
  }, [favoriteItems]);

  const openShelfEditor = (item: FavoriteItem) => {
    setEditingItem(item);
    setDraftStatus(item.shelfStatus);
    setDraftRating(item.favorite.personal_rating || '');
    setDraftNote(item.favorite.personal_note || '');
  };

  const handleSaveShelfItem = async () => {
    if (!editingItem || saving) return;

    setSaving(true);
    try {
      const updatedFavorite: Favorite = {
        ...editingItem.favorite,
        shelf_status: draftStatus,
        personal_rating: draftRating || undefined,
        personal_note: draftNote.trim() || undefined,
      };

      await saveFavorite(editingItem.source, editingItem.id, updatedFavorite);
      setFavoriteItems((items) =>
        items.map((item) =>
          item.source === editingItem.source && item.id === editingItem.id
            ? {
                ...item,
                favorite: updatedFavorite,
                shelfStatus: draftStatus,
              }
            : item
        )
      );
      setEditingItem(null);
    } catch (error) {
      console.error('保存片架信息失败:', error);
    } finally {
      setSaving(false);
    }
  };

  // 清空所有收藏
  const handleClearAll = async () => {
    try {
      await clearAllFavorites();
      setFavoriteItems([]);
      setShowConfirmDialog(false);
    } catch (error) {
      console.error('清空收藏失败:', error);
    }
  };

  // 打开面板时加载收藏
  useEffect(() => {
    if (isOpen) {
      loadFavorites();
    }
  }, [isOpen]);

  // 监听收藏变化,实时移除已取消收藏的项目
  useEffect(() => {
    const unsubscribe = subscribeToDataUpdates('favoritesUpdated', async () => {
      if (isOpen) {
        await loadFavorites(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000]'
        onClick={onClose}
      />

      {/* 收藏面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1001] flex flex-col overflow-hidden'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-2'>
            <Star className='w-5 h-5 text-yellow-500' />
            <h3 className='text-lg font-bold text-gray-800 dark:text-gray-200'>
              我的收藏
            </h3>
            {favoriteItems.length > 0 && (
              <span className='px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full'>
                {favoriteItems.length} 项
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {favoriteItems.length > 0 && (
              <button
                onClick={() => setShowConfirmDialog(true)}
                className='text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors'
              >
                清空全部
              </button>
            )}
            <button
              onClick={onClose}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>
        </div>

        {/* 收藏列表 */}
        <div className='flex-1 overflow-y-auto p-6'>
          {!loading && favoriteItems.length > 0 && (
            <div className='mb-6 flex gap-2 overflow-x-auto pb-1'>
              <button
                onClick={() => setActiveFilter('all')}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                全部 {favoriteItems.length}
              </button>
              {SHELF_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setActiveFilter(option.value)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    activeFilter === option.value
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {option.label} {filterCounts[option.value]}
                </button>
              ))}
            </div>
          )}
          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <div className='w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin'></div>
            </div>
          ) : favoriteItems.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400'>
              <Star className='w-12 h-12 mb-3 opacity-30' />
              <p className='text-sm'>暂无收藏内容</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400'>
              <SlidersHorizontal className='mb-3 h-10 w-10 opacity-30' />
              <p className='text-sm'>这个片架还没有内容</p>
            </div>
          ) : (
            <div className='grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
              {visibleItems.map((item) => (
                <div key={item.id + item.source} className='w-full'>
                  <VideoCard
                    query={item.search_title}
                    {...item}
                    from='favorite'
                    type={item.episodes && item.episodes > 1 ? 'tv' : ''}
                  />
                  <button
                    onClick={() => openShelfEditor(item)}
                    className='mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-yellow-100 hover:text-yellow-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-300'
                  >
                    <SlidersHorizontal className='h-3.5 w-3.5' />
                    {
                      SHELF_STATUS_OPTIONS.find(
                        (option) => option.value === item.shelfStatus
                      )?.label
                    }
                    {item.favorite.personal_rating
                      ? ` · ${
                          PERSONAL_RATING_OPTIONS.find(
                            (option) =>
                              option.value === item.favorite.personal_rating
                          )?.label
                        }`
                      : ''}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 确认对话框 */}
      {showConfirmDialog && createPortal(
        <div
          className='fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4 transition-opacity duration-300'
          onClick={() => setShowConfirmDialog(false)}
        >
          <div
            className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full border border-red-200 dark:border-red-800 transition-all duration-300'
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              {/* 图标和标题 */}
              <div className="flex items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    清空收藏
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    确定要清空所有收藏吗？此操作不可恢复。
                  </p>
                </div>
              </div>

              {/* 按钮组 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowConfirmDialog(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleClearAll}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                >
                  确定清空
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingItem && createPortal(
        <div
          className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm'
          onClick={() => !saving && setEditingItem(null)}
        >
          <div
            className='w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='mb-5 flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs font-medium text-yellow-600 dark:text-yellow-400'>
                  整理我的片架
                </p>
                <h3 className='mt-1 text-lg font-bold text-gray-900 dark:text-gray-100'>
                  {editingItem.title}
                </h3>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                disabled={saving}
                className='rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                aria-label='关闭'
              >
                <X className='h-5 w-5' />
              </button>
            </div>

            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
              观看状态
            </label>
            <div className='mt-2 grid grid-cols-5 gap-1.5'>
              {SHELF_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setDraftStatus(option.value)}
                  className={`rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                    draftStatus === option.value
                      ? 'bg-yellow-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className='mt-5 block text-sm font-medium text-gray-700 dark:text-gray-300'>
              个人评价（可选）
            </label>
            <div className='mt-2 grid grid-cols-3 gap-2'>
              {PERSONAL_RATING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    setDraftRating((current) =>
                      current === option.value ? '' : option.value
                    )
                  }
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                    draftRating === option.value
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label
              htmlFor='personal-note'
              className='mt-5 block text-sm font-medium text-gray-700 dark:text-gray-300'
            >
              一句话备注（可选）
            </label>
            <textarea
              id='personal-note'
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value.slice(0, 120))}
              rows={3}
              maxLength={120}
              placeholder='比如：看完想再找同导演的作品'
              className='mt-2 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-yellow-400 focus:ring-2 focus:ring-yellow-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-yellow-900/40'
            />
            <div className='mt-1 text-right text-xs text-gray-400'>
              {draftNote.length}/120
            </div>

            <div className='mt-5 flex gap-3'>
              <button
                onClick={() => setEditingItem(null)}
                disabled={saving}
                className='flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              >
                取消
              </button>
              <button
                onClick={handleSaveShelfItem}
                disabled={saving}
                className='flex-1 rounded-xl bg-yellow-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 disabled:cursor-wait disabled:opacity-60'
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
